/**
 * NeuroShield Kids — Motor de pronóstico determinista v1
 * ======================================================
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * La versión anterior le pedía al modelo de lenguaje que predijera las
 * puntuaciones futuras del niño: a 3, 7 y 30 días, con intervalos de confianza
 * y escenarios. El modelo se los inventaba. Dos ejecuciones con los mismos
 * datos daban cifras distintas, y si la IA fallaba se guardaba en la base de
 * datos una predicción de relleno (50, riesgo medio) como si fuera real.
 *
 * Eso es inaceptable en un producto de salud mental infantil. Un padre podría
 * ver "dentro de 7 días el riesgo de su hijo será alto" sin que ese número
 * tenga ningún método detrás.
 *
 * Aquí la predicción se CALCULA. Son fórmulas fijas y auditables:
 *
 *   1. Tendencia por estimador de Theil–Sen (mediana de pendientes entre pares
 *      de puntos). Se elige frente a mínimos cuadrados porque es robusto: un
 *      solo día atípico —un domingo de fiebre, un viaje— no tuerce la recta.
 *
 *   2. Nivel actual por mediana de las últimas observaciones, no por el último
 *      valor suelto, para no proyectar desde un pico puntual.
 *
 *   3. Incertidumbre a partir de la desviación absoluta mediana de los
 *      residuos, ensanchada con el horizonte. Cuanto más lejos se mira y más
 *      ruidosa es la serie, más ancho es el intervalo. Es honesto por
 *      construcción.
 *
 *   4. El escenario "con intervención" NO se imagina: se calcula volviendo a
 *      ejecutar el motor clínico sobre los datos de hoy con el principal
 *      factor de riesgo devuelto a la línea base del propio niño. Es una
 *      pregunta concreta con respuesta concreta: "si el uso nocturno volviera
 *      a lo habitual en él, ¿qué puntuación saldría?".
 *
 *   5. Las señales de alerta temprana salen de los umbrales reales del motor
 *      clínico y de la distancia que le queda a este niño para cruzarlos.
 *
 * El modelo de lenguaje, igual que en el motor clínico, solo redacta.
 */

import { runClinicalEngine } from "./clinicalEngine.ts";
import type { DayMetric, EngineResult } from "./clinicalEngine.ts";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface ScorePoint {
  /** Fecha ISO (yyyy-mm-dd). */
  date: string;
  /** Puntuación 0-100 emitida por el motor clínico ese día. */
  score: number;
}

export interface Horizon {
  days: number;
  expected_score: number;
  low_score: number;
  high_score: number;
  risk_level: "low" | "medium" | "high";
  /** Anchura del intervalo: crece con el horizonte y con el ruido de la serie. */
  interval_width: number;
}

export interface EarlyWarning {
  signal: string;
  /** Umbral concreto del motor clínico. */
  threshold: string;
  /** Lo que marca hoy este niño. */
  current: string;
  /** Cuánto le falta para cruzarlo. Negativo = ya cruzado. */
  margin: string;
}

export interface Counterfactual {
  /** Qué se ha modificado para calcularlo. */
  change: string;
  /** Puntuación de hoy con ese cambio aplicado. */
  score_if_applied: number;
  /** Puntuación real de hoy. */
  score_now: number;
  /** Mejora calculada (positiva = mejoraría). */
  improvement: number;
}

export interface ForecastResult {
  forecastable: boolean;
  not_forecastable_reason?: string;

  /** Método usado, para que sea auditable. */
  method: string;
  engine_version: string;

  horizons: Horizon[];
  trend: "improving" | "stable" | "worsening";
  /** Puntos por día. Negativo = mejorando. */
  slope_per_day: number;
  /** Nivel actual robusto (mediana de las últimas observaciones). */
  current_level: number;

  counterfactual: Counterfactual | null;
  early_warnings: EarlyWarning[];

  /** 0-100. Baja con series cortas o ruidosas. */
  confidence: number;
  trace: {
    observations: number;
    span_days: number;
    residual_mad: number;
    /** Días que se apartan tanto de la tendencia que se consideran atípicos. */
    anomalous_days: number;
    computed_at: string;
  };
}

export const FORECAST_VERSION = "1.0.0";

/** Mínimo de observaciones para que una tendencia signifique algo. */
const MIN_OBSERVATIONS = 7;

// ── Estadística robusta ───────────────────────────────────────────────────────

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Desviación absoluta mediana: dispersión que no se deja arrastrar por outliers. */
function mad(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/**
 * Estimador de Theil–Sen: mediana de las pendientes entre todos los pares.
 *
 * Frente a una regresión por mínimos cuadrados, aguanta hasta un 29% de puntos
 * atípicos sin desviarse. En series de 7 a 30 días con la vida real de por
 * medio, eso importa.
 */
function theilSenSlope(points: Array<{ x: number; y: number }>): number {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j].x - points[i].x;
      if (dx === 0) continue;
      slopes.push((points[j].y - points[i].y) / dx);
    }
  }
  return slopes.length ? median(slopes) : 0;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(v)));

function riskFor(score: number): "low" | "medium" | "high" {
  return score >= 70 ? "high" : score >= 40 ? "medium" : "low";
}

// ── Motor ─────────────────────────────────────────────────────────────────────

export interface ForecastInput {
  /** Serie de puntuaciones, cualquier orden. Solo días evaluables. */
  history: ScorePoint[];
  /** Métrica de hoy, para el contrafactual. */
  today?: DayMetric;
  /** Historial de métricas, para la línea base del contrafactual. */
  metricHistory?: DayMetric[];
  age?: number;
  /** Resultado del motor clínico de hoy, si ya se calculó. */
  todayEngine?: EngineResult;
}

export function runForecast(input: ForecastInput): ForecastResult {
  const { history, today, metricHistory = [], age = 12, todayEngine } = input;

  const base = {
    method: "Theil–Sen sobre puntuaciones del motor clínico; intervalo por MAD "
      + "ensanchado con el horizonte; contrafactual por re-ejecución del motor",
    engine_version: FORECAST_VERSION,
  };

  // ── Puerta: sin serie no hay pronóstico ─────────────────────────────────────
  const clean = history
    .filter((p) => typeof p.score === "number" && !Number.isNaN(p.score))
    .map((p) => ({ ...p, t: Date.parse(p.date) }))
    .filter((p) => !Number.isNaN(p.t))
    .sort((a, b) => a.t - b.t);

  if (clean.length < MIN_OBSERVATIONS) {
    return {
      forecastable: false,
      not_forecastable_reason:
        `Hacen falta al menos ${MIN_OBSERVATIONS} días de análisis para proyectar una `
        + `tendencia con sentido. Ahora mismo hay ${clean.length}. `
        + `Antes de eso, cualquier predicción sería adivinar.`,
      ...base,
      horizons: [],
      trend: "stable",
      slope_per_day: 0,
      current_level: clean.length ? clean[clean.length - 1].score : 0,
      counterfactual: null,
      early_warnings: [],
      confidence: 0,
      trace: {
        observations: clean.length,
        span_days: 0,
        residual_mad: 0,
        anomalous_days: 0,
        computed_at: new Date().toISOString(),
      },
    };
  }

  // ── Tendencia ───────────────────────────────────────────────────────────────
  const dayMs = 86_400_000;
  const t0 = clean[0].t;
  const pts = clean.map((p) => ({ x: (p.t - t0) / dayMs, y: p.score }));
  const spanDays = pts[pts.length - 1].x;

  const slope = theilSenSlope(pts);

  // Nivel actual: mediana de las últimas 3 observaciones, para no proyectar
  // desde un pico aislado.
  const lastN = clean.slice(-3).map((p) => p.score);
  const currentLevel = median(lastN);

  // Residuos respecto a la recta ajustada, anclada en el nivel actual.
  const lastX = pts[pts.length - 1].x;
  const residuals = pts.map((p) => p.y - (currentLevel + slope * (p.x - lastX)));
  const residualMad = mad(residuals);

  // Recuento de días anómalos.
  //
  // La mediana absoluta es deliberadamente insensible a valores extremos: eso
  // es lo que hace que un domingo raro no tuerza la tendencia. Pero por lo
  // mismo, ignorarlos del todo haría que el intervalo pareciera más estrecho
  // de lo que merece una serie que ha tenido sobresaltos.
  //
  // Así que la tendencia se mantiene robusta y las anomalías se contabilizan
  // aparte: ensanchan el intervalo y bajan la confianza. Se es firme con la
  // estimación y honesto con la incertidumbre.
  const sigmaResid = residualMad * 1.4826;
  const anomalyCutoff = Math.max(10, sigmaResid * 3);
  const anomalies = residuals.filter((r) => Math.abs(r) > anomalyCutoff).length;

  // ── Horizontes ──────────────────────────────────────────────────────────────
  // El intervalo se ensancha con la raíz del horizonte: a 30 días se sabe
  // bastante menos que a 3, y el intervalo debe reflejarlo.
  const horizons: Horizon[] = [3, 7, 30].map((h) => {
    const expected = clamp(currentLevel + slope * h);
    // 1.4826 convierte MAD en equivalente a desviación típica bajo normalidad.
    // Cada día anómalo ensancha el intervalo: la serie ha demostrado que puede
    // dar saltos, y el pronóstico debe admitirlo.
    const sigma = sigmaResid;
    const anomalyWidening = anomalies * 3;
    const width = Math.max(4, sigma * Math.sqrt(1 + h / Math.max(1, spanDays)) * 1.5)
      + anomalyWidening;
    return {
      days: h,
      expected_score: expected,
      low_score: clamp(expected - width),
      high_score: clamp(expected + width),
      risk_level: riskFor(expected),
      interval_width: Math.round(width),
    };
  });

  // ── Etiqueta de tendencia ───────────────────────────────────────────────────
  // Solo se declara tendencia si la pendiente supera el ruido de la serie.
  const noisePerDay = (residualMad * 1.4826) / Math.max(1, spanDays);
  const meaningful = Math.abs(slope) > Math.max(0.3, noisePerDay);
  const trend: ForecastResult["trend"] = !meaningful
    ? "stable"
    : slope > 0 ? "worsening" : "improving";

  // ── Contrafactual: ¿y si se corrige el principal factor? ────────────────────
  const counterfactual = buildCounterfactual(today, metricHistory, age, todayEngine);

  // ── Señales de alerta temprana, con umbrales reales ─────────────────────────
  const early_warnings = buildEarlyWarnings(today, metricHistory, age);

  // ── Confianza ───────────────────────────────────────────────────────────────
  let confidence = 25;
  if (clean.length >= 10) confidence += 15;
  if (clean.length >= 20) confidence += 15;
  if (spanDays >= 14) confidence += 10;
  // Serie ruidosa = menos confianza en la proyección.
  if (residualMad <= 5) confidence += 20;
  else if (residualMad <= 12) confidence += 10;
  // Cada día anómalo resta confianza: la serie es menos predecible de lo que
  // sugiere su tendencia.
  confidence -= anomalies * 10;
  confidence = clamp(confidence, 10, 90);

  return {
    forecastable: true,
    ...base,
    horizons,
    trend,
    slope_per_day: Math.round(slope * 100) / 100,
    current_level: Math.round(currentLevel),
    counterfactual,
    early_warnings,
    confidence,
    trace: {
      observations: clean.length,
      span_days: Math.round(spanDays),
      residual_mad: Math.round(residualMad * 10) / 10,
      anomalous_days: anomalies,
      computed_at: new Date().toISOString(),
    },
  };
}

// ── Contrafactual ─────────────────────────────────────────────────────────────

/**
 * Responde una pregunta concreta: si el principal factor de riesgo volviera a
 * la línea base de este mismo niño, ¿qué puntuación saldría hoy?
 *
 * No es una opinión: se vuelve a ejecutar el motor clínico con ese único valor
 * cambiado. Por eso el resultado es verificable y siempre el mismo.
 */
function buildCounterfactual(
  today: DayMetric | undefined,
  metricHistory: DayMetric[],
  age: number,
  todayEngine?: EngineResult,
): Counterfactual | null {
  if (!today) return null;

  const current = todayEngine
    ?? runClinicalEngine({ age, today, history: metricHistory });
  if (!current.assessable || current.emotional_score === null) return null;

  const topDim = current.evidence[0]?.dimension;
  if (!topDim) return null;

  // Línea base del propio niño para el factor que más pesa.
  const baselineNight = metricHistory.length
    ? median(metricHistory.map((h) => h.night_minutes ?? 0))
    : 0;
  const baselineTotal = metricHistory.length
    ? median(metricHistory.map((h) => h.total_minutes ?? 0))
    : 0;

  const modified: DayMetric = JSON.parse(JSON.stringify(today));
  let change = "";

  if (topDim === "sleep_disruption") {
    modified.night_minutes = baselineNight;
    if (modified.behavioral_signals) {
      modified.behavioral_signals = {
        ...modified.behavioral_signals,
        night_minutes: baselineNight,
        night_unlocks: 0,
        dark_unlocks: 0,
      };
    }
    change = `Si el uso nocturno volviera a su media habitual (${Math.round(baselineNight)} min) `
      + `y no hubiera despertares con el móvil`;
  } else if (topDim === "dependency") {
    modified.total_minutes = baselineTotal;
    if (modified.behavioral_signals) {
      const baseUnlocks = median(
        metricHistory
          .map((h) => h.behavioral_signals?.unlocks)
          .filter((v): v is number => typeof v === "number"),
      );
      modified.behavioral_signals = {
        ...modified.behavioral_signals,
        unlocks: baseUnlocks || modified.behavioral_signals.unlocks,
        phantom_pickups: 0,
      };
    }
    change = `Si el tiempo de uso volviera a su media habitual (${Math.round(baselineTotal)} min) `
      + `y dejara de coger el móvil sin motivo`;
  } else if (topDim === "anxiety_signals" && modified.behavioral_signals) {
    modified.behavioral_signals = {
      ...modified.behavioral_signals,
      fast_response_ratio: 0.3,
      dark_unlocks: 0,
      night_unlocks: 0,
    };
    change = "Si dejara de responder de forma inmediata a cada mensaje y no usara el móvil a oscuras";
  } else if (topDim === "attention_fragmentation" && modified.behavioral_signals) {
    modified.behavioral_signals = {
      ...modified.behavioral_signals,
      switches_per_minute: 0.3,
      avg_session_seconds: Math.max(180, modified.behavioral_signals.avg_session_seconds ?? 180),
    };
    change = "Si las sesiones fueran más largas y cambiara menos de aplicación";
  } else {
    return null;
  }

  const after = runClinicalEngine({ age, today: modified, history: metricHistory });
  if (!after.assessable || after.emotional_score === null) return null;

  return {
    change,
    score_if_applied: after.emotional_score,
    score_now: current.emotional_score,
    improvement: current.emotional_score - after.emotional_score,
  };
}

// ── Señales de alerta temprana ────────────────────────────────────────────────

/**
 * No son sugerencias genéricas: son los umbrales que el motor clínico usa de
 * verdad, con el valor actual de este niño y lo que le falta para cruzarlos.
 */
function buildEarlyWarnings(
  today: DayMetric | undefined,
  metricHistory: DayMetric[],
  age: number,
): EarlyWarning[] {
  if (!today) return [];
  const sig = today.behavioral_signals ?? {};
  const out: EarlyWarning[] = [];

  // Uso nocturno — umbral de derivación profesional del motor
  const night = sig.night_minutes ?? today.night_minutes ?? 0;
  out.push({
    signal: "Uso nocturno (23:00–06:00)",
    threshold: "90 min — a partir de ahí se recomienda consultar con un profesional",
    current: `${night} min`,
    margin: `${90 - night} min`,
  });

  // Desbloqueos — umbral de comprobación compulsiva
  if (typeof sig.unlocks === "number") {
    out.push({
      signal: "Desbloqueos diarios del dispositivo",
      threshold: "50 — por encima se considera comprobación compulsiva",
      current: `${sig.unlocks}`,
      margin: `${50 - sig.unlocks}`,
    });
  }

  // Sueño frente a lo recomendado por edad
  const sleepMin = sig.sleep_minutes ?? sig.longest_idle_gap_minutes ?? 0;
  if (sleepMin > 0) {
    const needH = age <= 5 ? 11 : age <= 12 ? 10 : age <= 17 ? 9 : 8;
    const sleepH = sleepMin / 60;
    out.push({
      signal: "Horas de descanso",
      threshold: `${needH} h recomendadas para ${age} años`,
      current: `${sleepH.toFixed(1)} h`,
      margin: `${(sleepH - needH).toFixed(1)} h`,
    });
  }

  // Escalada respecto a su propia media
  if (metricHistory.length >= 3) {
    const baseAvg = median(metricHistory.map((h) => h.total_minutes ?? 0));
    const pct = baseAvg > 0
      ? Math.round(((today.total_minutes - baseAvg) / baseAvg) * 100)
      : 0;
    out.push({
      signal: "Escalada frente a su patrón habitual",
      threshold: "+35% — indicio de tolerancia en las escalas clínicas",
      current: `${pct > 0 ? "+" : ""}${pct}%`,
      margin: `${35 - pct} puntos porcentuales`,
    });
  }

  return out;
}
