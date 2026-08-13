/**
 * NeuroShield Kids — Motor clínico determinista v3
 * ================================================
 *
 * Este módulo sustituye el juicio de riesgo que antes emitía el modelo de
 * lenguaje. Aquí NO interviene ninguna IA: son fórmulas fijas, de modo que los
 * mismos datos producen siempre el mismo resultado.
 *
 * El reparto de responsabilidades pasa a ser:
 *   - Este motor DECIDE (puntúa dimensiones, detecta cambios, marca evidencia)
 *   - El modelo de lenguaje TRADUCE (explica al padre, propone la conversación)
 *
 * Con eso el análisis pasa a ser reproducible, trazable y auditable, que es lo
 * que exige cualquier revisión clínica o técnica seria.
 *
 * Principio de puntuación: cada niño se compara consigo mismo. Los umbrales
 * absolutos solo se usan cuando existe respaldo en la literatura (por ejemplo
 * el uso nocturno o el número de desbloqueos diarios).
 */

// ── Tipos ─────────────────────────────────────────────────────────────────────

/** Señales nativas que envía la app Android. Todas opcionales: la web no las tiene. */
export interface NativeSignals {
  source?: string;
  schema_version?: number;
  unlocks?: number;
  screen_ons?: number;
  night_unlocks?: number;
  dark_unlocks?: number;
  avg_lux?: number;
  longest_idle_gap_minutes?: number;
  first_use_ms?: number;
  last_use_ms?: number;
  app_switches?: number;
  switches_per_minute?: number;
  distinct_apps?: number;
  session_entropy?: number;
  avg_session_seconds?: number;
  longest_session_seconds?: number;
  night_minutes?: number;

  // Exclusivo de iOS (HealthKit): sueño medido, no estimado.
  sleep_minutes?: number;
  /** Hora de conciliación en decimal: 23.5 = 23:30. */
  sleep_onset_hour?: number;
  sleep_fragmentation?: number;
  resting_heart_rate?: number;
  hrv_ms?: number;
}

export interface DayMetric {
  metric_date?: string;
  total_minutes: number;
  night_minutes: number;
  sessions: number;
  dominant_app?: string | null;
  app_breakdown?: Record<string, number> | null;
  behavioral_signals?: NativeSignals | null;
}

export interface EngineInput {
  age: number;
  today: DayMetric;
  /** Historial ordenado de más reciente a más antiguo, SIN incluir hoy. */
  history: DayMetric[];
}

export interface Evidence {
  /** Qué se afirma. */
  claim: string;
  /** Métrica concreta que lo respalda, con su valor. */
  data_point: string;
  /** Dimensión a la que contribuye. */
  dimension: DimensionKey;
  /** Cuántos puntos aporta a esa dimensión. */
  impact: number;
}

export type DimensionKey =
  | "sleep_disruption"
  | "anxiety_signals"
  | "mood_volatility"
  | "social_withdrawal"
  | "dependency"
  | "attention_fragmentation";

export interface EngineResult {
  emotional_score: number;
  risk_level: "low" | "medium" | "high";
  severity_tier: "preventive" | "watch" | "moderate" | "critical";
  /** 0-100. Baja con poco historial o sin señales nativas. */
  confidence: number;
  dimensions: Record<DimensionKey, number>;
  /** Dimensiones que no pueden calcularse con los datos disponibles. */
  unavailable_dimensions: DimensionKey[];
  evidence: Evidence[];
  /** Dominios de escalas clínicas con indicios medibles. */
  clinical_domains: ClinicalDomain[];
  change_point: ChangePoint | null;
  refer_to_professional: boolean;
  referral_reason: string;
  /** Trazabilidad: contexto de cálculo para auditoría. */
  trace: {
    engine_version: string;
    data_days: number;
    has_native_signals: boolean;
    baseline_total_minutes: number | null;
    computed_at: string;
  };
}

export interface ClinicalDomain {
  /** Nombre del dominio en la literatura. */
  domain: string;
  /** Instrumento de referencia. */
  instrument: string;
  met: boolean;
  rationale: string;
}

export interface ChangePoint {
  date: string;
  metric: string;
  direction: "increase" | "decrease";
  magnitude_pct: number;
}

// ── Utilidades estadísticas ───────────────────────────────────────────────────

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/**
 * Desviación en sigmas respecto a la línea base del propio niño.
 * Se aplica un suelo a la desviación típica para que un historial muy plano
 * no dispare z-scores enormes ante variaciones triviales.
 */
function zScore(value: number, baseline: number[], sdFloor: number): number {
  if (baseline.length < 3) return 0;
  const sd = Math.max(stdDev(baseline), sdFloor);
  return (value - mean(baseline)) / sd;
}

/** Convierte un z-score en puntos de riesgo (0..max), a partir de 1 sigma. */
function zToPoints(z: number, max: number): number {
  if (z <= 1) return 0;
  return Math.min(max, Math.round(((z - 1) / 2) * max));
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(v)));

// ── Categorización de apps ────────────────────────────────────────────────────

type AppCategory = "social" | "messaging" | "video" | "gaming" | "education" | "creative" | "other";

/**
 * Mapa de paquetes conocidos. Se usa para distinguir consumo pasivo de
 * interacción social, que es la base de la dimensión de aislamiento.
 */
const PACKAGE_CATEGORIES: Record<string, AppCategory> = {
  "com.whatsapp": "messaging",
  "org.telegram.messenger": "messaging",
  "com.facebook.orca": "messaging",
  "com.discord": "messaging",
  "com.snapchat.android": "messaging",
  "com.google.android.apps.messaging": "messaging",
  "com.instagram.android": "social",
  "com.zhiliaoapp.musically": "video", // TikTok
  "com.ss.android.ugc.trill": "video",
  "com.google.android.youtube": "video",
  "com.netflix.mediaclient": "video",
  "com.twitter.android": "social",
  "com.reddit.frontpage": "social",
  "com.facebook.katana": "social",
  "com.roblox.client": "gaming",
  "com.mojang.minecraftpe": "gaming",
  "com.supercell.brawlstars": "gaming",
  "com.epicgames.fortnite": "gaming",
  "com.duolingo": "education",
  "com.google.android.apps.classroom": "education",
  "com.khanacademy.android": "education",
  "com.spotify.music": "other",
};

function categorize(pkg: string): AppCategory {
  if (PACKAGE_CATEGORIES[pkg]) return PACKAGE_CATEGORIES[pkg];
  const p = pkg.toLowerCase();
  if (/(whatsapp|telegram|messenger|chat|signal)/.test(p)) return "messaging";
  if (/(insta|tiktok|snap|twitter|facebook|reddit|social)/.test(p)) return "social";
  if (/(youtube|netflix|video|tv|prime)/.test(p)) return "video";
  if (/(game|games|play\.)/.test(p)) return "gaming";
  if (/(school|edu|learn|duolingo|classroom)/.test(p)) return "education";
  return "other";
}

function categoryMinutes(breakdown: Record<string, number> | null | undefined) {
  const out: Record<AppCategory, number> = {
    social: 0, messaging: 0, video: 0, gaming: 0, education: 0, creative: 0, other: 0,
  };
  if (!breakdown) return out;
  for (const [pkg, mins] of Object.entries(breakdown)) {
    out[categorize(pkg)] += Number(mins) || 0;
  }
  return out;
}

// ── Referencias por edad ──────────────────────────────────────────────────────

/** Horas de sueño recomendadas (American Academy of Sleep Medicine). */
function recommendedSleepHours(age: number): number {
  if (age <= 5) return 11;
  if (age <= 12) return 10;
  if (age <= 17) return 9;
  return 8;
}

/** Minutos diarios de pantalla recreativa considerados de referencia por edad. */
function referenceScreenMinutes(age: number): number {
  if (age <= 5) return 60;
  if (age <= 8) return 90;
  if (age <= 12) return 120;
  return 180;
}

// ── Motor ─────────────────────────────────────────────────────────────────────

export const ENGINE_VERSION = "3.0.0";

export function runClinicalEngine(input: EngineInput): EngineResult {
  const { age, today, history } = input;
  const sig: NativeSignals = today.behavioral_signals ?? {};
  const hasNative = Boolean(sig.source === "android_native" || sig.unlocks !== undefined);

  const evidence: Evidence[] = [];
  const dims: Record<DimensionKey, number> = {
    sleep_disruption: 0,
    anxiety_signals: 0,
    mood_volatility: 0,
    social_withdrawal: 0,
    dependency: 0,
    attention_fragmentation: 0,
  };
  const unavailable: DimensionKey[] = [];

  const add = (dimension: DimensionKey, impact: number, claim: string, data_point: string) => {
    if (impact <= 0) return;
    dims[dimension] += impact;
    evidence.push({ dimension, impact, claim, data_point });
  };

  // Líneas base del propio niño
  const baseTotals = history.map((h) => h.total_minutes);
  const baseNights = history.map((h) => h.night_minutes);
  const baseUnlocks = history
    .map((h) => h.behavioral_signals?.unlocks)
    .filter((v): v is number => typeof v === "number");

  const baselineTotal = baseTotals.length >= 3 ? Math.round(mean(baseTotals)) : null;

  // ── 1. Alteración del sueño ────────────────────────────────────────────────
  // Es la dimensión con evidencia científica más sólida: la cadena uso nocturno
  // → menos sueño → sintomatología afectiva está ampliamente documentada.
  {
    const nightMin = sig.night_minutes ?? today.night_minutes ?? 0;

    // Cualquier uso sostenido después de las 23:00 en un menor es señal. El
    // umbral arranca pronto (10 min) porque el daño al sueño no requiere horas.
    if (nightMin > 10) {
      const pts = Math.min(35, Math.round((nightMin - 10) / 2.5));
      add("sleep_disruption", pts, "Uso del dispositivo en franja nocturna",
        `${nightMin} min entre las 23:00 y las 06:00`);
    }

    const zNight = zScore(nightMin, baseNights, 8);
    add("sleep_disruption", zToPoints(zNight, 15),
      "Uso nocturno por encima de su patrón habitual",
      `${zNight.toFixed(1)} sigmas sobre su media (${Math.round(mean(baseNights))} min)`);

    if (typeof sig.night_unlocks === "number" && sig.night_unlocks >= 3) {
      const pts = Math.min(20, sig.night_unlocks * 3);
      add("sleep_disruption", pts, "Despertares con uso del móvil durante la noche",
        `${sig.night_unlocks} desbloqueos nocturnos`);
    }

    // Duración del descanso frente a la recomendación por edad.
    // Se prefiere el sueño medido de HealthKit (iOS) sobre la estimación por
    // inactividad (Android), y se dice cuál se ha usado para no confundirlos.
    const measuredSleep = typeof sig.sleep_minutes === "number" && sig.sleep_minutes > 0;
    const sleepMinutes = measuredSleep ? sig.sleep_minutes! : (sig.longest_idle_gap_minutes ?? 0);

    if (sleepMinutes > 0) {
      const sleepH = sleepMinutes / 60;
      const needH = recommendedSleepHours(age);
      if (sleepH < needH) {
        const deficit = needH - sleepH;
        // El dato medido merece más peso que la estimación por inactividad.
        const pts = Math.min(measuredSleep ? 30 : 25, Math.round(deficit * 12));
        add("sleep_disruption", pts,
          measuredSleep
            ? "Duerme menos de lo recomendado para su edad"
            : "Ventana de descanso por debajo de lo recomendado para su edad",
          measuredSleep
            ? `${sleepH.toFixed(1)} h de sueño medido frente a ${needH} h recomendadas`
            : `${sleepH.toFixed(1)} h sin actividad frente a ${needH} h recomendadas`);
      }
    }

    // Sueño fragmentado: despertares repetidos a lo largo de la noche
    if (typeof sig.sleep_fragmentation === "number" && sig.sleep_fragmentation >= 3) {
      const pts = Math.min(20, sig.sleep_fragmentation * 4);
      add("sleep_disruption", pts, "Sueño fragmentado con despertares repetidos",
        `${sig.sleep_fragmentation} interrupciones durante la noche`);
    }

    // Retraso de fase: conciliar cada vez más tarde es uno de los marcadores
    // más consistentes de desajuste circadiano en adolescentes.
    if (typeof sig.sleep_onset_hour === "number") {
      const onset = sig.sleep_onset_hour;
      // Normalizamos: 0-6 h se interpreta como madrugada (24-30)
      const norm = onset < 6 ? onset + 24 : onset;
      const lateThreshold = age <= 12 ? 22.5 : 23.5;
      if (norm > lateThreshold) {
        const pts = Math.min(20, Math.round((norm - lateThreshold) * 10));
        const h = Math.floor(onset);
        const m = Math.round((onset - h) * 60);
        add("sleep_disruption", pts, "Se duerme más tarde de lo aconsejable para su edad",
          `conciliación a las ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      }
    }
  }

  // ── 1b. Marcadores biométricos de estrés (solo iOS con wearable) ───────────
  {
    // La frecuencia cardíaca en reposo elevada y la variabilidad baja son
    // marcadores validados de estrés sostenido. Solo se usan si existen.
    if (typeof sig.hrv_ms === "number" && sig.hrv_ms > 0 && sig.hrv_ms < 30) {
      const pts = Math.min(20, Math.round((30 - sig.hrv_ms)));
      add("anxiety_signals", pts, "Variabilidad cardíaca baja, compatible con estrés sostenido",
        `VFC de ${Math.round(sig.hrv_ms)} ms`);
    }
    const baseHR = history
      .map((h) => h.behavioral_signals?.resting_heart_rate)
      .filter((v): v is number => typeof v === "number");
    if (typeof sig.resting_heart_rate === "number" && baseHR.length >= 5) {
      const z = zScore(sig.resting_heart_rate, baseHR, 3);
      add("anxiety_signals", zToPoints(z, 15),
        "Frecuencia cardíaca en reposo por encima de su patrón",
        `${Math.round(sig.resting_heart_rate)} lpm, ${z.toFixed(1)} sigmas sobre su media`);
    }
  }

  // ── 2. Dependencia ─────────────────────────────────────────────────────────
  {
    const totalMin = today.total_minutes ?? 0;
    const ref = referenceScreenMinutes(age);

    if (totalMin > ref) {
      const pts = Math.min(25, Math.round((totalMin - ref) / 12));
      add("dependency", pts, "Tiempo de pantalla por encima de la referencia de su edad",
        `${totalMin} min frente a ${ref} min de referencia`);
    }

    const zTotal = zScore(totalMin, baseTotals, 15);
    add("dependency", zToPoints(zTotal, 20),
      "Escalada respecto a su propio patrón",
      `${zTotal.toFixed(1)} sigmas sobre su media (${baselineTotal ?? "n/d"} min)`);

    // Desbloqueos diarios: indicador directo de compulsividad.
    // Por encima de ~50 al día se considera patrón de comprobación compulsiva.
    if (typeof sig.unlocks === "number") {
      if (sig.unlocks > 50) {
        const pts = Math.min(45, Math.round((sig.unlocks - 50) / 1.8));
        add("dependency", pts, "Comprobación compulsiva del dispositivo",
          `${sig.unlocks} desbloqueos en el día`);
      }
      const zUnlock = zScore(sig.unlocks, baseUnlocks, 6);
      add("dependency", zToPoints(zUnlock, 12),
        "Aumento de desbloqueos sobre su patrón",
        `${zUnlock.toFixed(1)} sigmas sobre su media`);
    } else {
      // Sin app nativa no hay forma de contar desbloqueos.
      unavailable.push("dependency");
    }

    // Concentración en una sola aplicación
    if (today.app_breakdown && totalMin > 0) {
      const vals = Object.values(today.app_breakdown).map(Number);
      const sum = vals.reduce((a, b) => a + b, 0) || 1;
      const ratio = Math.max(...vals) / sum;
      if (ratio > 0.7) {
        const pts = Math.min(15, Math.round((ratio - 0.7) * 50));
        add("dependency", pts, "Uso concentrado en una única aplicación",
          `${Math.round(ratio * 100)}% del tiempo en ${today.dominant_app ?? "una sola app"}`);
      }
    }
  }

  // ── 3. Fragmentación de la atención ────────────────────────────────────────
  {
    if (typeof sig.switches_per_minute === "number" && sig.switches_per_minute > 0) {
      if (sig.switches_per_minute > 0.5) {
        const pts = Math.min(40, Math.round((sig.switches_per_minute - 0.5) * 40));
        add("attention_fragmentation", pts, "Cambio de aplicación muy frecuente",
          `${sig.switches_per_minute.toFixed(2)} cambios por minuto de uso`);
      }
      const avgSec = sig.avg_session_seconds ?? 0;
      if (avgSec > 0 && avgSec < 60) {
        const pts = Math.min(25, Math.round((60 - avgSec) / 2));
        add("attention_fragmentation", pts, "Sesiones muy cortas: dificultad para sostener el foco",
          `${avgSec} s de duración media por sesión`);
      }
      if (typeof sig.session_entropy === "number" && sig.session_entropy > 0.8 && avgSec > 0 && avgSec < 120) {
        add("attention_fragmentation", 15, "Actividad muy dispersa entre muchas apps",
          `entropía ${sig.session_entropy.toFixed(2)} con sesiones de ${avgSec} s`);
      }
    } else {
      unavailable.push("attention_fragmentation");
    }
  }

  // ── 4. Señales de ansiedad ─────────────────────────────────────────────────
  // Nota: la métrica más específica (latencia de respuesta a notificaciones)
  // requiere el permiso de notificaciones, que se solicita en una fase posterior.
  {
    if (typeof sig.unlocks === "number") {
      const totalMin = today.total_minutes || 1;
      // Muchos desbloqueos con poco tiempo de uso = comprobar y cerrar,
      // patrón característico de comprobación ansiosa.
      const checkRatio = sig.unlocks / totalMin;
      if (sig.unlocks >= 30 && checkRatio > 0.4) {
        const pts = Math.min(30, Math.round(checkRatio * 40));
        add("anxiety_signals", pts, "Patrón de comprobar y cerrar sin llegar a usarlo",
          `${sig.unlocks} desbloqueos para ${totalMin} min de uso`);
      }
      if ((sig.night_unlocks ?? 0) >= 2) {
        add("anxiety_signals", Math.min(20, (sig.night_unlocks ?? 0) * 5),
          "Comprobaciones durante la noche",
          `${sig.night_unlocks} desbloqueos nocturnos`);
      }
      // Uso a oscuras: conducta de ocultación, asociada a malestar
      if ((sig.dark_unlocks ?? 0) >= 3) {
        const pts = Math.min(20, (sig.dark_unlocks ?? 0) * 4);
        add("anxiety_signals", pts, "Uso del dispositivo a oscuras, posible ocultación",
          `${sig.dark_unlocks} desbloqueos con luz ambiental muy baja`);
      }
    } else {
      unavailable.push("anxiety_signals");
    }
  }

  // ── 5. Aislamiento social ──────────────────────────────────────────────────
  {
    const cats = categoryMinutes(today.app_breakdown);
    const interactive = cats.messaging;
    const passive = cats.video + cats.social;
    const known = interactive + passive + cats.gaming + cats.education;

    if (known > 20) {
      const passiveRatio = passive / (interactive + passive || 1);
      if (passiveRatio > 0.8 && passive > 45) {
        const pts = Math.min(30, Math.round((passiveRatio - 0.8) * 100));
        add("social_withdrawal", pts, "Consumo pasivo muy por encima de la interacción con otros",
          `${Math.round(passive)} min de consumo frente a ${Math.round(interactive)} min de conversación`);
      }

      // Caída de la interacción respecto a su propia línea base
      const baseInteractive = history
        .map((h) => categoryMinutes(h.app_breakdown).messaging)
        .filter((v) => v > 0);
      if (baseInteractive.length >= 3) {
        const avg = mean(baseInteractive);
        if (avg > 10 && interactive < avg * 0.5) {
          const pts = Math.min(25, Math.round((1 - interactive / avg) * 30));
          add("social_withdrawal", pts, "Descenso marcado de la comunicación con otras personas",
            `${Math.round(interactive)} min frente a ${Math.round(avg)} min habituales`);
        }
      }
    } else {
      unavailable.push("social_withdrawal");
    }

    // Pérdida de variedad de actividad
    if (typeof sig.distinct_apps === "number") {
      const baseDistinct = history
        .map((h) => h.behavioral_signals?.distinct_apps)
        .filter((v): v is number => typeof v === "number");
      if (baseDistinct.length >= 3) {
        const avg = mean(baseDistinct);
        if (avg >= 4 && sig.distinct_apps < avg * 0.6) {
          add("social_withdrawal", 12, "Reducción de la variedad de actividades en el dispositivo",
            `${sig.distinct_apps} apps distintas frente a ${avg.toFixed(1)} habituales`);
        }
      }
    }
  }

  // ── 6. Volatilidad del estado de ánimo ─────────────────────────────────────
  // Es la dimensión más indirecta. Se apoya en irregularidad del ritmo diario,
  // que en la literatura de fenotipado digital correlaciona con desregulación.
  {
    if (baseTotals.length >= 5) {
      const cv = stdDev(baseTotals) / (mean(baseTotals) || 1);
      if (cv > 0.5) {
        const pts = Math.min(25, Math.round((cv - 0.5) * 50));
        add("mood_volatility", pts, "Patrón de uso muy irregular de un día a otro",
          `variabilidad del ${Math.round(cv * 100)}% sobre su media`);
      }

      // Irregularidad de la hora de inicio: desajuste del ritmo circadiano
      const firstUses = [today, ...history]
        .map((d) => d.behavioral_signals?.first_use_ms)
        .filter((v): v is number => typeof v === "number")
        .map((ms) => new Date(ms).getHours() + new Date(ms).getMinutes() / 60);
      if (firstUses.length >= 5) {
        const sd = stdDev(firstUses);
        if (sd > 2) {
          const pts = Math.min(20, Math.round((sd - 2) * 10));
          add("mood_volatility", pts, "Horario de inicio del día muy irregular",
            `desviación de ${sd.toFixed(1)} h en la hora de primer uso`);
        }
      }
    } else {
      unavailable.push("mood_volatility");
    }
  }

  // ── Detección de punto de cambio (CUSUM simplificado) ──────────────────────
  const change_point = detectChangePoint([today, ...history]);
  if (change_point && change_point.direction === "increase" && change_point.magnitude_pct >= 40) {
    add("dependency", 10, "Cambio sostenido de patrón detectado",
      `+${change_point.magnitude_pct}% desde el ${change_point.date}`);
  }

  // ── Normalización ──────────────────────────────────────────────────────────
  for (const k of Object.keys(dims) as DimensionKey[]) dims[k] = clamp(dims[k]);

  // Score global: media ponderada. Sueño y dependencia pesan más porque son
  // las dimensiones con soporte empírico más fuerte y menos inferencia.
  const weights: Record<DimensionKey, number> = {
    sleep_disruption: 0.28,
    dependency: 0.24,
    anxiety_signals: 0.16,
    attention_fragmentation: 0.14,
    social_withdrawal: 0.12,
    mood_volatility: 0.06,
  };
  let weighted = 0;
  let weightSum = 0;
  let topDimension = 0;
  for (const k of Object.keys(dims) as DimensionKey[]) {
    if (unavailable.includes(k)) continue;
    weighted += dims[k] * weights[k];
    weightSum += weights[k];
    if (dims[k] > topDimension) topDimension = dims[k];
  }
  const weightedMean = weightSum > 0 ? weighted / weightSum : 0;

  // Criterio de triaje: una sola dimensión grave YA es grave, aunque el resto
  // esté bien. Un niño que duerme cinco horas por el móvil tiene un problema
  // serio aunque su vida social y su atención sean normales; promediarlo con
  // las dimensiones tranquilas lo enmascararía.
  const emotional_score = clamp(Math.max(weightedMean, topDimension * 0.85));

  const risk_level: EngineResult["risk_level"] =
    emotional_score >= 70 ? "high" : emotional_score >= 40 ? "medium" : "low";

  const severity_tier: EngineResult["severity_tier"] =
    emotional_score >= 80 ? "critical"
      : emotional_score >= 60 ? "moderate"
      : emotional_score >= 35 ? "watch"
      : "preventive";

  // ── Confianza ──────────────────────────────────────────────────────────────
  // Un sistema serio declara cuánto sabe. Con pocos días o sin señales nativas
  // la confianza baja y así se comunica al padre.
  const dataDays = history.length;
  let confidence = 30;
  if (dataDays >= 3) confidence += 15;
  if (dataDays >= 7) confidence += 15;
  if (dataDays >= 14) confidence += 10;
  if (hasNative) confidence += 25;
  confidence -= unavailable.length * 5;
  confidence = clamp(confidence, 10, 95);

  // ── Derivación profesional ─────────────────────────────────────────────────
  const referralReasons: string[] = [];
  if ((sig.night_minutes ?? today.night_minutes) > 90) {
    referralReasons.push("uso nocturno superior a 90 minutos");
  }
  if (dims.sleep_disruption >= 75) {
    referralReasons.push("alteración severa del descanso");
  }
  const sustainedHigh = history.slice(0, 3).length === 3 &&
    history.slice(0, 3).every((h) => h.total_minutes > 360) && today.total_minutes > 360;
  if (sustainedHigh) referralReasons.push("más de 6 h diarias sostenidas durante 3+ días");
  if (dims.social_withdrawal >= 70) referralReasons.push("patrón de aislamiento marcado");

  return {
    emotional_score,
    risk_level,
    severity_tier,
    confidence,
    dimensions: dims,
    unavailable_dimensions: unavailable,
    evidence: evidence.sort((a, b) => b.impact - a.impact).slice(0, 8),
    clinical_domains: mapClinicalDomains(dims, sig, today, history, age),
    change_point,
    refer_to_professional: referralReasons.length > 0,
    referral_reason: referralReasons.join("; "),
    trace: {
      engine_version: ENGINE_VERSION,
      data_days: dataDays,
      has_native_signals: hasNative,
      baseline_total_minutes: baselineTotal,
      computed_at: new Date().toISOString(),
    },
  };
}

// ── Mapeo a dominios de instrumentos clínicos ─────────────────────────────────

/**
 * Traduce las métricas conductuales a los dominios de escalas publicadas.
 *
 * Importante: esto NO es un diagnóstico. Indica qué dominios presentan
 * indicios observables en el comportamiento digital. Solo se incluyen los
 * dominios que pueden sostenerse con datos de uso; los que requieren
 * autoinforme del menor (engaño, escape emocional) quedan fuera a propósito.
 */
function mapClinicalDomains(
  dims: Record<DimensionKey, number>,
  sig: NativeSignals,
  today: DayMetric,
  history: DayMetric[],
  age: number,
): ClinicalDomain[] {
  const out: ClinicalDomain[] = [];
  const baseTotals = history.map((h) => h.total_minutes);
  const baseAvg = baseTotals.length >= 3 ? mean(baseTotals) : null;

  // Tolerancia: necesidad creciente de tiempo para obtener la misma satisfacción
  const escalation = baseAvg && baseAvg > 0 ? (today.total_minutes - baseAvg) / baseAvg : 0;
  out.push({
    domain: "Tolerancia (escalada de tiempo)",
    instrument: "IGDS9-SF / SAS-SV",
    met: escalation > 0.35,
    rationale: baseAvg
      ? `Uso actual ${Math.round(escalation * 100)}% respecto a su media de ${Math.round(baseAvg)} min`
      : "Historial insuficiente para evaluar escalada",
  });

  // Pérdida de control: comprobación compulsiva
  out.push({
    domain: "Pérdida de control",
    instrument: "IGDS9-SF",
    met: (sig.unlocks ?? 0) > 50 || dims.dependency >= 60,
    rationale: sig.unlocks !== undefined
      ? `${sig.unlocks} desbloqueos diarios`
      : "Requiere app nativa para contar desbloqueos",
  });

  // Desplazamiento: la pantalla sustituye sueño u otras actividades
  out.push({
    domain: "Desplazamiento de otras actividades",
    instrument: "PMUM / IGDS9-SF",
    met: dims.sleep_disruption >= 50 || dims.social_withdrawal >= 50,
    rationale: `Alteración del sueño ${dims.sleep_disruption}/100, aislamiento ${dims.social_withdrawal}/100`,
  });

  // Persistencia: el patrón se mantiene pese a ser problemático
  const persistentDays = history.slice(0, 5)
    .filter((h) => h.night_minutes > 30 || h.total_minutes > referenceScreenMinutes(age)).length;
  out.push({
    domain: "Persistencia del patrón",
    instrument: "IGDS9-SF",
    met: persistentDays >= 3,
    rationale: `${persistentDays} de los últimos 5 días con patrón elevado`,
  });

  // Preocupación: el dispositivo es lo primero y lo último del día
  const firstHour = sig.first_use_ms ? new Date(sig.first_use_ms).getHours() : null;
  const lastHour = sig.last_use_ms ? new Date(sig.last_use_ms).getHours() : null;
  out.push({
    domain: "Preocupación / saliencia",
    instrument: "SAS-SV",
    met: (lastHour !== null && (lastHour >= 23 || lastHour < 3)) && (firstHour !== null && firstHour < 8),
    rationale: firstHour !== null && lastHour !== null
      ? `Primer uso a las ${firstHour}:00, último a las ${lastHour}:00`
      : "Requiere app nativa",
  });

  return out;
}

// ── Detección de punto de cambio ──────────────────────────────────────────────

/**
 * CUSUM simplificado sobre el tiempo total diario.
 *
 * A veces lo más valioso para un padre no es la etiqueta, sino saber
 * exactamente cuándo cambió la trayectoria de su hijo.
 */
function detectChangePoint(series: DayMetric[]): ChangePoint | null {
  if (series.length < 8) return null;

  // La serie llega de más reciente a más antigua; la invertimos.
  const ordered = [...series].reverse();
  const values = ordered.map((d) => d.total_minutes);

  let best: { idx: number; diff: number } | null = null;
  const minSegment = 3;

  for (let i = minSegment; i <= values.length - minSegment; i++) {
    const before = mean(values.slice(0, i));
    const after = mean(values.slice(i));
    const diff = Math.abs(after - before);
    if (!best || diff > best.diff) best = { idx: i, diff };
  }

  if (!best) return null;

  const before = mean(values.slice(0, best.idx));
  const after = mean(values.slice(best.idx));
  if (before <= 0) return null;

  const pct = Math.round(((after - before) / before) * 100);
  if (Math.abs(pct) < 30) return null;

  return {
    date: ordered[best.idx].metric_date ?? `hace ${values.length - best.idx} días`,
    metric: "tiempo total diario",
    direction: pct > 0 ? "increase" : "decrease",
    magnitude_pct: Math.abs(pct),
  };
}
