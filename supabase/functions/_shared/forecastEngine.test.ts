/**
 * Banco de pruebas del motor de pronóstico.
 *
 * Lo que se verifica no es que "prediga bien el futuro" —eso nadie puede
 * garantizarlo— sino que el método sea correcto, reproducible y honesto:
 * que no proyecte sin datos, que el intervalo se ensanche con el horizonte,
 * que aguante días atípicos y que el contrafactual se calcule de verdad.
 */
import { runForecast, FORECAST_VERSION } from "./forecastEngine.ts";
import type { ScorePoint, ForecastInput } from "./forecastEngine.ts";
import type { DayMetric } from "./clinicalEngine.ts";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function section(t: string) {
  console.log(`\n${"─".repeat(70)}\n${t}\n${"─".repeat(70)}`);
}

/** Serie con fecha real y valores dados. */
function serie(valores: number[], desde = "2026-05-01"): ScorePoint[] {
  const base = Date.parse(desde);
  return valores.map((score, i) => ({
    date: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
    score,
  }));
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 1 · SEGURIDAD · Serie corta — no se proyecta nada");
// ══════════════════════════════════════════════════════════════════════════════
{
  const r = runForecast({ history: serie([30, 35, 40]) });
  console.log(`  proyectable=${r.forecastable} horizontes=${r.horizons.length}`);
  console.log(`  motivo: ${r.not_forecastable_reason?.slice(0, 70)}...`);

  check("no proyectable con 3 días", r.forecastable === false);
  check("sin horizontes inventados", r.horizons.length === 0);
  check("confianza cero", r.confidence === 0);
  check("explica por qué", (r.not_forecastable_reason ?? "").includes("7"));
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 2 · Tendencia claramente al alza");
// ══════════════════════════════════════════════════════════════════════════════
{
  const r = runForecast({ history: serie([20, 25, 30, 36, 41, 47, 52, 58, 63, 69]) });
  console.log(`  pendiente=${r.slope_per_day}/día tendencia=${r.trend} nivel=${r.current_level}`);
  r.horizons.forEach(h => console.log(`    ${h.days}d: ${h.low_score}–${h.high_score} (esperado ${h.expected_score}, ${h.risk_level})`));

  check("detecta empeoramiento", r.trend === "worsening");
  check("pendiente positiva ~5/día", r.slope_per_day > 4 && r.slope_per_day < 6, `${r.slope_per_day}`);
  check("proyección a 3d por encima del nivel actual",
    r.horizons[0].expected_score > r.current_level);
  check("riesgo alto a 7 días", r.horizons[1].risk_level === "high",
    `${r.horizons[1].expected_score}`);
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 3 · Tendencia a la baja — el niño mejora");
// ══════════════════════════════════════════════════════════════════════════════
{
  const r = runForecast({ history: serie([80, 76, 71, 67, 62, 58, 53, 49, 44, 40]) });
  console.log(`  pendiente=${r.slope_per_day}/día tendencia=${r.trend}`);
  console.log(`    7d: esperado ${r.horizons[1].expected_score}`);

  check("detecta mejora", r.trend === "improving");
  check("pendiente negativa", r.slope_per_day < 0);
  check("proyección a la baja", r.horizons[1].expected_score < r.current_level);
  check("nunca por debajo de 0", r.horizons[2].low_score >= 0, `${r.horizons[2].low_score}`);
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 4 · Serie estable — no inventa tendencia donde no la hay");
// ══════════════════════════════════════════════════════════════════════════════
{
  const r = runForecast({ history: serie([45, 47, 44, 46, 45, 48, 44, 46, 45, 47]) });
  console.log(`  pendiente=${r.slope_per_day}/día tendencia=${r.trend}`);

  check("declara estable", r.trend === "stable", r.trend);
  check("pendiente casi nula", Math.abs(r.slope_per_day) < 1, `${r.slope_per_day}`);
  check("proyección cerca del nivel actual",
    Math.abs(r.horizons[1].expected_score - r.current_level) < 8);
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 5 · ROBUSTEZ · Un día atípico no tuerce la predicción");
// ══════════════════════════════════════════════════════════════════════════════
{
  const limpia = runForecast({ history: serie([40, 42, 44, 46, 48, 50, 52, 54, 56, 58]) });
  // Mismo patrón con un día disparado en medio (fiebre, viaje, un domingo raro)
  const conOutlier = runForecast({ history: serie([40, 42, 44, 100, 48, 50, 52, 54, 56, 58]) });

  console.log(`  sin outlier: pendiente=${limpia.slope_per_day} 7d=${limpia.horizons[1].expected_score}`);
  console.log(`  con outlier: pendiente=${conOutlier.slope_per_day} 7d=${conOutlier.horizons[1].expected_score}`);

  const desvio = Math.abs(conOutlier.horizons[1].expected_score - limpia.horizons[1].expected_score);
  check("el día atípico apenas mueve la proyección", desvio <= 5, `desvío de ${desvio} puntos`);
  check("la pendiente se mantiene", Math.abs(conOutlier.slope_per_day - limpia.slope_per_day) < 1);
  check("pero el intervalo se ensancha al detectar ruido",
    conOutlier.horizons[1].interval_width > limpia.horizons[1].interval_width,
    `${conOutlier.horizons[1].interval_width} vs ${limpia.horizons[1].interval_width}`);
  check("y la confianza baja", conOutlier.confidence < limpia.confidence,
    `${conOutlier.confidence} vs ${limpia.confidence}`);
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 6 · El intervalo se ensancha con el horizonte");
// ══════════════════════════════════════════════════════════════════════════════
{
  const r = runForecast({ history: serie([30, 36, 33, 40, 37, 44, 41, 48, 45, 52]) });
  const [h3, h7, h30] = r.horizons;
  console.log(`  anchuras: 3d=${h3.interval_width} 7d=${h7.interval_width} 30d=${h30.interval_width}`);

  check("3d más estrecho que 7d", h3.interval_width < h7.interval_width);
  check("7d más estrecho que 30d", h7.interval_width < h30.interval_width);
  check("a 30 días el intervalo es amplio y lo dice", h30.interval_width >= 8,
    `${h30.interval_width}`);
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 7 · REPRODUCIBILIDAD · mismo dato, mismo pronóstico");
// ══════════════════════════════════════════════════════════════════════════════
{
  const datos = serie([25, 31, 28, 38, 35, 44, 41, 50, 47, 56, 53, 62]);
  const runs = [1, 2, 3].map(() => runForecast({ history: structuredClone(datos) }));

  console.log(`  7d en 3 ejecuciones: ${runs.map(r => r.horizons[1].expected_score).join(", ")}`);

  check("horizontes idénticos",
    runs.every(r => JSON.stringify(r.horizons) === JSON.stringify(runs[0].horizons)));
  check("pendiente idéntica", runs.every(r => r.slope_per_day === runs[0].slope_per_day));
  check("confianza idéntica", runs.every(r => r.confidence === runs[0].confidence));
  check("declara el método usado", runs[0].method.includes("Theil"));
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 8 · CONTRAFACTUAL · se calcula, no se imagina");
// ══════════════════════════════════════════════════════════════════════════════
{
  const histMetricas: DayMetric[] = Array.from({ length: 14 }, (_, i) => ({
    metric_date: `2026-05-${String(20 - i).padStart(2, "0")}`,
    total_minutes: 150, night_minutes: 10, sessions: 20,
    app_breakdown: { "com.whatsapp": 60, "com.google.android.youtube": 90 },
    behavioral_signals: { source: "android_native", unlocks: 35, night_minutes: 10 },
  }));

  const hoy: DayMetric = {
    metric_date: "2026-05-21",
    total_minutes: 300, night_minutes: 110, sessions: 45,
    dominant_app: "com.zhiliaoapp.musically",
    app_breakdown: { "com.zhiliaoapp.musically": 240, "com.whatsapp": 60 },
    behavioral_signals: {
      source: "android_native",
      unlocks: 70, night_unlocks: 8, dark_unlocks: 6,
      longest_idle_gap_minutes: 310, night_minutes: 110,
      switches_per_minute: 0.4, distinct_apps: 6, avg_session_seconds: 400,
    },
  };

  const r = runForecast({
    history: serie([55, 58, 62, 60, 65, 68, 72, 70, 75, 78]),
    today: hoy,
    metricHistory: histMetricas,
    age: 13,
  });

  console.log(`  contrafactual:`, r.counterfactual);

  check("genera contrafactual", r.counterfactual !== null);
  check("parte de la puntuación real de hoy",
    (r.counterfactual?.score_now ?? 0) > 0);
  check("la corrección mejora la puntuación",
    (r.counterfactual?.improvement ?? 0) > 0,
    `mejora de ${r.counterfactual?.improvement}`);
  check("explica exactamente qué se cambió",
    (r.counterfactual?.change ?? "").length > 25);
  check("menciona la línea base del propio niño",
    /habitual|media/i.test(r.counterfactual?.change ?? ""));
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 9 · ALERTAS TEMPRANAS con umbrales reales");
// ══════════════════════════════════════════════════════════════════════════════
{
  const hoy: DayMetric = {
    metric_date: "2026-05-21",
    total_minutes: 200, night_minutes: 60, sessions: 30,
    app_breakdown: { "com.instagram.android": 200 },
    behavioral_signals: {
      source: "android_native",
      unlocks: 42, night_minutes: 60, sleep_minutes: 420,
    },
  };
  const hist: DayMetric[] = Array.from({ length: 10 }, () => ({
    total_minutes: 150, night_minutes: 20, sessions: 20,
    behavioral_signals: { source: "android_native", unlocks: 30 },
  }));

  const r = runForecast({
    history: serie([40, 44, 42, 48, 46, 52, 50, 56, 54, 60]),
    today: hoy, metricHistory: hist, age: 14,
  });

  console.log(`  alertas:`);
  r.early_warnings.forEach(w => console.log(`    ${w.signal}: ${w.current} / umbral ${w.threshold.slice(0, 40)} → margen ${w.margin}`));

  check("genera alertas", r.early_warnings.length >= 3);
  check("todas llevan umbral concreto",
    r.early_warnings.every(w => w.threshold.length > 5));
  check("todas llevan el valor actual del niño",
    r.early_warnings.every(w => w.current.length > 0));
  check("todas dicen cuánto falta para cruzarlo",
    r.early_warnings.every(w => w.margin.length > 0));
  check("incluye uso nocturno",
    r.early_warnings.some(w => /nocturno/i.test(w.signal)));
  check("incluye desbloqueos",
    r.early_warnings.some(w => /desbloqueo/i.test(w.signal)));
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 10 · Rangos válidos y trazabilidad");
// ══════════════════════════════════════════════════════════════════════════════
{
  // Serie extrema para forzar los límites
  const r = runForecast({ history: serie([5, 20, 35, 50, 65, 80, 95, 99, 98, 97]) });
  const todos = r.horizons.flatMap(h => [h.expected_score, h.low_score, h.high_score]);

  console.log(`  valores: ${todos.join(", ")}`);
  console.log(`  traza:`, r.trace);

  check("todo entre 0 y 100", todos.every(v => v >= 0 && v <= 100));
  check("todo entero", todos.every(v => Number.isInteger(v)));
  check("low <= esperado <= high",
    r.horizons.every(h => h.low_score <= h.expected_score && h.expected_score <= h.high_score));
  check("registra nº de observaciones", r.trace.observations === 10);
  check("registra el ruido de la serie", typeof r.trace.residual_mad === "number");
  check("registra versión", r.engine_version === FORECAST_VERSION);
}

// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(70)}`);
console.log(`RESULTADO:  ${passed} correctas · ${failed} fallidas`);
if (failed > 0) {
  console.log(`\nFallos:`);
  failures.forEach(f => console.log(`  · ${f}`));
}
console.log("═".repeat(70));

// @ts-ignore - process existe bajo Node
if (typeof process !== "undefined") process.exit(failed > 0 ? 1 : 0);
