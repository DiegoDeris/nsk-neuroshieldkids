/**
 * Motor de scoring emocional NeuroShield Kids
 * v2 — Heurística determinista + momentum temporal que el motor IA puede afinar después.
 * Inputs: métricas de uso digital + historial opcional. Output: score 0-100 + nivel de riesgo.
 */
export type Metric = {
  total_minutes: number;
  night_minutes: number;
  sessions: number;
  dominant_app?: string | null;
  app_breakdown?: Record<string, number> | null;
  prev_week_avg_minutes?: number;
};

export type HistoryPoint = {
  total_minutes: number;
  night_minutes: number;
  sessions: number;
  metric_date?: string;
};

export type ScoreResult = {
  score: number;
  risk_level: "low" | "medium" | "high";
  factors: { label: string; impact: number }[];
};

export function computeEmotionalScore(m: Metric): ScoreResult {
  let score = 0;
  const factors: { label: string; impact: number }[] = [];

  // 1. Exceso de uso diario (>120m suma; cap 35)
  if (m.total_minutes > 120) {
    const v = Math.min(35, Math.round((m.total_minutes - 120) / 10));
    score += v;
    factors.push({ label: "Exceso de tiempo diario", impact: v });
  }
  // 2. Uso nocturno (>30m fuerte; cap 25)
  if (m.night_minutes > 30) {
    const v = Math.min(25, Math.round((m.night_minutes - 30) / 4));
    score += v;
    factors.push({ label: "Uso nocturno elevado", impact: v });
  }
  // 3. Aumento semanal >30%
  if (m.prev_week_avg_minutes && m.prev_week_avg_minutes > 0) {
    const delta = (m.total_minutes - m.prev_week_avg_minutes) / m.prev_week_avg_minutes;
    if (delta > 0.3) {
      const v = Math.min(20, Math.round(delta * 30));
      score += v;
      factors.push({ label: `Aumento ${Math.round(delta * 100)}% vs semana previa`, impact: v });
    }
  }
  // 4. Sesiones excesivas
  if (m.sessions > 30) {
    const v = Math.min(15, m.sessions - 30);
    score += v;
    factors.push({ label: "Demasiadas sesiones cortas", impact: v });
  }
  // 5. Concentración en una sola app (>70%)
  if (m.app_breakdown && m.total_minutes > 0) {
    const total = Object.values(m.app_breakdown).reduce((a, b) => a + b, 0) || 1;
    const top = Math.max(...Object.values(m.app_breakdown));
    const ratio = top / total;
    if (ratio > 0.7) {
      const v = Math.min(15, Math.round((ratio - 0.7) * 50));
      score += v;
      factors.push({ label: "Dependencia de una sola app", impact: v });
    }
  }

  score = Math.max(0, Math.min(100, score));
  const risk_level = score >= 70 ? "high" : score >= 40 ? "medium" : "low";
  return { score, risk_level, factors };
}

/**
 * Versión mejorada que incorpora momentum temporal y velocidad de cambio.
 * Usar cuando hay historial disponible (página de detalle del hijo, análisis diario).
 */
export function computeScoreWithHistory(m: Metric, history: HistoryPoint[] = []): ScoreResult {
  const base = computeEmotionalScore(m);
  let score = base.score;
  const factors = [...base.factors];

  // Momentum: 3+ días consecutivos con score >= 60 → escalación (+15)
  if (history.length >= 3) {
    const recentScores = history.slice(0, 3).map(h =>
      computeEmotionalScore({ total_minutes: h.total_minutes, night_minutes: h.night_minutes, sessions: h.sessions }).score
    );
    if (recentScores.every(s => s >= 60)) {
      const v = 15;
      score = Math.min(100, score + v);
      factors.push({ label: "Patrón persistente (3+ días consecutivos)", impact: v });
    }
  }

  // Velocidad: tendencia al alza en últimos 5 días
  if (history.length >= 5) {
    const recent5 = history.slice(0, 5).map(h =>
      computeEmotionalScore({ total_minutes: h.total_minutes, night_minutes: h.night_minutes, sessions: h.sessions }).score
    );
    const oldest = recent5[recent5.length - 1];
    const newest = recent5[0];
    const velocity = newest - oldest;
    if (velocity > 20) {
      const v = Math.min(10, Math.round(velocity / 5));
      score = Math.min(100, score + v);
      factors.push({ label: `Tendencia creciente +${Math.round(velocity)} pts en 5 días`, impact: v });
    }
  }

  // Nocturno crónico: 3+ noches consecutivas >45min → señal de adicción (alta gravedad)
  if (history.length >= 2) {
    const nightChronic = history.slice(0, 3).filter(h => h.night_minutes > 45).length;
    if (nightChronic >= 2) {
      const v = 10;
      score = Math.min(100, score + v);
      factors.push({ label: `Uso nocturno crónico (${nightChronic} noches)`, impact: v });
    }
  }

  score = Math.max(0, Math.min(100, score));
  const risk_level = score >= 70 ? "high" : score >= 40 ? "medium" : "low";
  return { score, risk_level, factors };
}

export function riskColor(level: "low" | "medium" | "high") {
  return level === "low" ? "success" : level === "medium" ? "warning" : "danger";
}

export function riskLabel(level: "low" | "medium" | "high") {
  return level === "low" ? "Saludable" : level === "medium" ? "Atención" : "Riesgo alto";
}

/** Devuelve cuántas horas han pasado desde una fecha ISO. */
export function hoursAgo(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / 3_600_000;
}
