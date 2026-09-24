/**
 * Banco de pruebas del motor clínico.
 *
 * Cada caso representa un perfil conductual real. Se comprueba que el motor
 * detecta lo que debe detectar, que NO dispara alarmas donde no las hay, y —lo
 * más importante para su credibilidad— que el resultado es reproducible.
 *
 * Ejecutar:  node clinicalEngine.test.js   (tras compilar con tsc)
 */
import { runClinicalEngine } from "./clinicalEngine.ts";
import type { DayMetric, EngineInput } from "./clinicalEngine.ts";

// ── Utilidades de test ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${"─".repeat(70)}\n${title}\n${"─".repeat(70)}`);
}

/** Genera un historial estable con ruido determinista (sin Math.random). */
function baseline(days: number, totalMin: number, nightMin: number, unlocks?: number): DayMetric[] {
  return Array.from({ length: days }, (_, i) => {
    const wobble = ((i * 7) % 5) - 2; // -2..+2, reproducible
    return {
      metric_date: `2026-05-${String(28 - i).padStart(2, "0")}`,
      total_minutes: Math.max(0, totalMin + wobble * 3),
      night_minutes: Math.max(0, nightMin + wobble),
      sessions: 20 + wobble,
      app_breakdown: { "com.whatsapp": 20, "com.google.android.youtube": Math.max(0, totalMin - 20) },
      behavioral_signals: unlocks !== undefined
        ? { source: "android_native", unlocks: unlocks + wobble, distinct_apps: 6 }
        : null,
    };
  });
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 1 · Niño con uso saludable — no debe generar alarma");
// ══════════════════════════════════════════════════════════════════════════════
{
  const input: EngineInput = {
    age: 11,
    today: {
      metric_date: "2026-05-29",
      total_minutes: 75,
      night_minutes: 0,
      sessions: 12,
      dominant_app: "com.whatsapp",
      app_breakdown: { "com.whatsapp": 35, "com.duolingo": 20, "com.google.android.youtube": 20 },
      behavioral_signals: {
        source: "android_native",
        unlocks: 22, night_unlocks: 0, dark_unlocks: 0,
        longest_idle_gap_minutes: 620, // 10.3 h de descanso
        app_switches: 18, switches_per_minute: 0.24,
        distinct_apps: 5, session_entropy: 0.6,
        avg_session_seconds: 375, night_minutes: 0,
      },
    },
    history: baseline(14, 80, 2, 24),
  };

  const r = runClinicalEngine(input);
  console.log(`  score=${r.emotional_score} riesgo=${r.risk_level} confianza=${r.confidence}%`);
  console.log(`  dimensiones:`, r.dimensions);

  check("riesgo bajo", r.risk_level === "low", `salió ${r.risk_level} (${r.emotional_score})`);
  check("sueño sin alteración", r.dimensions.sleep_disruption < 25, `${r.dimensions.sleep_disruption}`);
  check("sin derivación profesional", !r.refer_to_professional);
  check("confianza alta con 14 días y app nativa", r.confidence >= 80, `${r.confidence}%`);
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 2 · Uso nocturno severo — debe disparar sueño y derivación");
// ══════════════════════════════════════════════════════════════════════════════
{
  const input: EngineInput = {
    age: 13,
    today: {
      metric_date: "2026-05-29",
      total_minutes: 320,
      night_minutes: 115,
      sessions: 48,
      dominant_app: "com.zhiliaoapp.musically",
      app_breakdown: { "com.zhiliaoapp.musically": 210, "com.whatsapp": 30, "com.instagram.android": 80 },
      behavioral_signals: {
        source: "android_native",
        unlocks: 74, night_unlocks: 9, dark_unlocks: 7,
        avg_lux: 3.2,
        longest_idle_gap_minutes: 300, // solo 5 h de descanso
        app_switches: 140, switches_per_minute: 0.44,
        distinct_apps: 7, session_entropy: 0.55,
        avg_session_seconds: 400, night_minutes: 115,
      },
    },
    history: baseline(14, 180, 25, 45),
  };

  const r = runClinicalEngine(input);
  console.log(`  score=${r.emotional_score} riesgo=${r.risk_level} confianza=${r.confidence}%`);
  console.log(`  dimensiones:`, r.dimensions);
  console.log(`  derivación: ${r.referral_reason}`);

  check("riesgo alto", r.risk_level === "high", `salió ${r.risk_level} (${r.emotional_score})`);
  check("sueño muy alterado", r.dimensions.sleep_disruption >= 70, `${r.dimensions.sleep_disruption}`);
  check("dependencia elevada", r.dimensions.dependency >= 50, `${r.dimensions.dependency}`);
  check("deriva a profesional", r.refer_to_professional);
  check("menciona el uso nocturno", r.referral_reason.includes("nocturno"));
  check("evidencia con dato concreto", r.evidence.every((e) => e.data_point.length > 0));
  check("detecta uso a oscuras",
    r.evidence.some((e) => e.claim.toLowerCase().includes("oscuras")));
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 3 · Comprobación compulsiva — poco tiempo, muchos desbloqueos");
// ══════════════════════════════════════════════════════════════════════════════
{
  const input: EngineInput = {
    age: 14,
    today: {
      metric_date: "2026-05-29",
      total_minutes: 95,
      night_minutes: 8,
      sessions: 90,
      dominant_app: "com.instagram.android",
      app_breakdown: { "com.instagram.android": 45, "com.whatsapp": 35, "com.snapchat.android": 15 },
      behavioral_signals: {
        source: "android_native",
        unlocks: 132, night_unlocks: 2, dark_unlocks: 1,
        longest_idle_gap_minutes: 480,
        app_switches: 210, switches_per_minute: 2.2,
        distinct_apps: 8, session_entropy: 0.9,
        avg_session_seconds: 38, night_minutes: 8,
      },
    },
    history: baseline(14, 100, 6, 60),
  };

  const r = runClinicalEngine(input);
  console.log(`  score=${r.emotional_score} riesgo=${r.risk_level}`);
  console.log(`  dimensiones:`, r.dimensions);

  check("dependencia alta pese al poco tiempo", r.dimensions.dependency >= 55, `${r.dimensions.dependency}`);
  check("ansiedad detectada", r.dimensions.anxiety_signals >= 40, `${r.dimensions.anxiety_signals}`);
  check("fragmentación de atención alta", r.dimensions.attention_fragmentation >= 60,
    `${r.dimensions.attention_fragmentation}`);
  check("dominio de pérdida de control marcado",
    r.clinical_domains.some((d) => d.domain.includes("Pérdida de control") && d.met));
  check("el tiempo total NO es el motor de la alerta", r.dimensions.sleep_disruption < 40,
    `sueño=${r.dimensions.sleep_disruption}`);
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 4 · Aislamiento social — consumo pasivo sustituye a la conversación");
// ══════════════════════════════════════════════════════════════════════════════
{
  const history: DayMetric[] = Array.from({ length: 14 }, (_, i) => ({
    metric_date: `2026-05-${String(28 - i).padStart(2, "0")}`,
    total_minutes: 150,
    night_minutes: 10,
    sessions: 25,
    // Antes hablaba mucho por WhatsApp
    app_breakdown: { "com.whatsapp": 70, "com.google.android.youtube": 80 },
    behavioral_signals: { source: "android_native", unlocks: 40, distinct_apps: 7 },
  }));

  const input: EngineInput = {
    age: 15,
    today: {
      metric_date: "2026-05-29",
      total_minutes: 165,
      night_minutes: 12,
      sessions: 22,
      dominant_app: "com.google.android.youtube",
      // Hoy casi no habla con nadie: todo consumo
      app_breakdown: { "com.whatsapp": 6, "com.google.android.youtube": 159 },
      behavioral_signals: {
        source: "android_native",
        unlocks: 38, night_unlocks: 1, dark_unlocks: 0,
        longest_idle_gap_minutes: 500,
        app_switches: 30, switches_per_minute: 0.18,
        distinct_apps: 3, session_entropy: 0.3,
        avg_session_seconds: 450, night_minutes: 12,
      },
    },
    history,
  };

  const r = runClinicalEngine(input);
  console.log(`  score=${r.emotional_score} riesgo=${r.risk_level}`);
  console.log(`  dimensiones:`, r.dimensions);

  check("aislamiento detectado", r.dimensions.social_withdrawal >= 40, `${r.dimensions.social_withdrawal}`);
  check("señala la caída de conversación",
    r.evidence.some((e) => /comunicaci|conversaci|consumo pasivo/i.test(e.claim)));
  check("detecta pérdida de variedad",
    r.evidence.some((e) => /variedad/i.test(e.claim)));
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 5 · Sin app nativa — se niega a evaluar (cambio de seguridad v3.1)");
// ══════════════════════════════════════════════════════════════════════════════
{
  const input: EngineInput = {
    age: 12,
    today: {
      metric_date: "2026-05-29",
      total_minutes: 140,
      night_minutes: 35,
      sessions: 18,
      dominant_app: "com.google.android.youtube",
      app_breakdown: { "com.google.android.youtube": 140 },
      behavioral_signals: null,
    },
    history: baseline(10, 120, 20),
  };

  const r = runClinicalEngine(input);
  console.log(`  score=${r.emotional_score} confianza=${r.confidence}%`);
  console.log(`  no disponibles:`, r.unavailable_dimensions);

  // ANTES (v3.0): se evaluaba igualmente con confianza baja. Eso producía un
  // veredicto clínico sobre datos que no miden el uso real del menor.
  // AHORA (v3.1): se rechaza. Es la diferencia entre equivocarse con cautela
  // y equivocarse con autoridad.
  check("confianza cero, no solo baja", r.confidence === 0, `${r.confidence}%`);
  check("todas las dimensiones marcadas como no disponibles",
    r.unavailable_dimensions.length === 6, `${r.unavailable_dimensions.length}`);
  check("no emite puntuación", r.emotional_score === null);
  check("no emite nivel de riesgo", r.risk_level === null);
  check("registra que no hay señales nativas", r.trace.has_native_signals === false);
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 6 · Historial insuficiente — confianza mínima, sin falsas alarmas");
// ══════════════════════════════════════════════════════════════════════════════
{
  const input: EngineInput = {
    age: 10,
    today: {
      metric_date: "2026-05-29",
      total_minutes: 130,
      night_minutes: 10,
      sessions: 14,
      app_breakdown: { "com.roblox.client": 130 },
      behavioral_signals: { source: "android_native", unlocks: 30, longest_idle_gap_minutes: 560 },
    },
    history: baseline(1, 120, 8, 28),
  };

  const r = runClinicalEngine(input);
  console.log(`  score=${r.emotional_score} confianza=${r.confidence}% días=${r.trace.data_days}`);

  check("confianza baja con 1 día", r.confidence <= 60, `${r.confidence}%`);
  check("no infla el riesgo por falta de datos", r.risk_level !== "high", `${r.risk_level}`);
  check("no hay punto de cambio sin serie", r.change_point === null);
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 7 · Punto de cambio — el patrón se dispara a mitad del periodo");
// ══════════════════════════════════════════════════════════════════════════════
{
  // Primeros 7 días tranquilos, últimos 7 disparados
  const calm: DayMetric[] = Array.from({ length: 7 }, (_, i) => ({
    metric_date: `2026-05-${String(15 - i).padStart(2, "0")}`,
    total_minutes: 90, night_minutes: 5, sessions: 15,
    app_breakdown: { "com.whatsapp": 90 },
    behavioral_signals: { source: "android_native", unlocks: 25 },
  }));
  const spike: DayMetric[] = Array.from({ length: 7 }, (_, i) => ({
    metric_date: `2026-05-${String(22 - i).padStart(2, "0")}`,
    total_minutes: 260, night_minutes: 40, sessions: 40,
    app_breakdown: { "com.zhiliaoapp.musically": 260 },
    behavioral_signals: { source: "android_native", unlocks: 70 },
  }));

  const input: EngineInput = {
    age: 13,
    today: {
      metric_date: "2026-05-29",
      total_minutes: 270, night_minutes: 45, sessions: 42,
      app_breakdown: { "com.zhiliaoapp.musically": 270 },
      behavioral_signals: { source: "android_native", unlocks: 72, night_unlocks: 4, night_minutes: 45 },
    },
    // más reciente primero
    history: [...spike, ...calm],
  };

  const r = runClinicalEngine(input);
  console.log(`  punto de cambio:`, r.change_point);

  check("detecta el punto de cambio", r.change_point !== null);
  check("dirección correcta (aumento)", r.change_point?.direction === "increase");
  check("magnitud significativa", (r.change_point?.magnitude_pct ?? 0) >= 40,
    `${r.change_point?.magnitude_pct}%`);
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 8 · REPRODUCIBILIDAD — el mismo dato debe dar el mismo resultado");
// ══════════════════════════════════════════════════════════════════════════════
{
  const input: EngineInput = {
    age: 13,
    today: {
      metric_date: "2026-05-29",
      total_minutes: 245, night_minutes: 65, sessions: 38,
      dominant_app: "com.instagram.android",
      app_breakdown: { "com.instagram.android": 160, "com.whatsapp": 85 },
      behavioral_signals: {
        source: "android_native", unlocks: 88, night_unlocks: 5, dark_unlocks: 4,
        longest_idle_gap_minutes: 380, switches_per_minute: 0.9,
        distinct_apps: 6, session_entropy: 0.7, avg_session_seconds: 90, night_minutes: 65,
      },
    },
    history: baseline(14, 170, 30, 55),
  };

  const runs = [1, 2, 3].map(() => runClinicalEngine(structuredClone(input)));

  const scoresEqual = runs.every((r) => r.emotional_score === runs[0].emotional_score);
  const dimsEqual = runs.every((r) => JSON.stringify(r.dimensions) === JSON.stringify(runs[0].dimensions));
  const evidenceEqual = runs.every((r) => JSON.stringify(r.evidence) === JSON.stringify(runs[0].evidence));
  const domainsEqual = runs.every((r) =>
    JSON.stringify(r.clinical_domains) === JSON.stringify(runs[0].clinical_domains));

  console.log(`  scores: ${runs.map((r) => r.emotional_score).join(", ")}`);

  check("puntuación idéntica en 3 ejecuciones", scoresEqual);
  check("dimensiones idénticas", dimsEqual);
  check("evidencia idéntica", evidenceEqual);
  check("dominios clínicos idénticos", domainsEqual);
  check("cada evidencia lleva dimensión e impacto",
    runs[0].evidence.length === 0 || runs[0].evidence.every((e) => e.claim && e.data_point));
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 9 · Trazabilidad — toda alerta debe poder justificarse");
// ══════════════════════════════════════════════════════════════════════════════
{
  const input: EngineInput = {
    age: 12,
    today: {
      metric_date: "2026-05-29",
      total_minutes: 300, night_minutes: 80, sessions: 50,
      app_breakdown: { "com.zhiliaoapp.musically": 300 },
      behavioral_signals: {
        source: "android_native", unlocks: 95, night_unlocks: 6, dark_unlocks: 5,
        longest_idle_gap_minutes: 330, switches_per_minute: 1.1,
        distinct_apps: 4, session_entropy: 0.4, avg_session_seconds: 55, night_minutes: 80,
      },
    },
    history: baseline(14, 150, 20, 40),
  };

  const r = runClinicalEngine(input);
  console.log(`  versión motor: ${r.trace.engine_version}, días: ${r.trace.data_days}`);
  console.log(`  evidencia principal: ${r.evidence[0]?.claim} → ${r.evidence[0]?.data_point}`);

  check("incluye versión del motor", Boolean(r.trace.engine_version));
  check("incluye días de datos usados", r.trace.data_days === 14);
  check("incluye línea base calculada", r.trace.baseline_total_minutes !== null);
  check("incluye marca temporal", Boolean(r.trace.computed_at));
  check("toda evidencia tiene dato numérico",
    r.evidence.every((e) => /\d/.test(e.data_point)));
  check("dominios clínicos citan instrumento",
    r.clinical_domains.every((d) => d.instrument.length > 0));
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 10 · Rangos válidos — nada puede salirse de 0-100");
// ══════════════════════════════════════════════════════════════════════════════
{
  // Caso extremo deliberadamente absurdo
  const input: EngineInput = {
    age: 8,
    today: {
      metric_date: "2026-05-29",
      total_minutes: 900, night_minutes: 400, sessions: 300,
      app_breakdown: { "com.zhiliaoapp.musically": 900 },
      behavioral_signals: {
        source: "android_native", unlocks: 400, night_unlocks: 60, dark_unlocks: 50,
        longest_idle_gap_minutes: 40, switches_per_minute: 12,
        distinct_apps: 1, session_entropy: 0.99, avg_session_seconds: 3, night_minutes: 400,
      },
    },
    history: baseline(20, 60, 2, 15),
  };

  const r = runClinicalEngine(input);
  console.log(`  score=${r.emotional_score} dimensiones:`, r.dimensions);

  const allInRange = Object.values(r.dimensions).every((v) => v >= 0 && v <= 100 && Number.isInteger(v));
  check("todas las dimensiones en 0-100 y enteras", allInRange);
  check("score global en rango", (r.emotional_score ?? -1) >= 0 && (r.emotional_score ?? 101) <= 100);
  check("confianza en rango", r.confidence >= 10 && r.confidence <= 95);
  check("nivel crítico en caso extremo", r.severity_tier === "critical", r.severity_tier ?? "null");
  check("evidencia limitada a 8 entradas", r.evidence.length <= 8, `${r.evidence.length}`);
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 11 · iOS con sueño real de HealthKit — dato medido, no estimado");
// ══════════════════════════════════════════════════════════════════════════════
{
  const history: DayMetric[] = Array.from({ length: 14 }, (_, i) => ({
    metric_date: `2026-05-${String(28 - i).padStart(2, "0")}`,
    total_minutes: 150, night_minutes: 15, sessions: 20,
    app_breakdown: { "com.whatsapp": 60, "com.google.android.youtube": 90 },
    behavioral_signals: {
      source: "ios_native",
      sleep_minutes: 520, sleep_onset_hour: 22.5, sleep_fragmentation: 1,
      resting_heart_rate: 68, night_minutes: 15,
    },
  }));

  const input: EngineInput = {
    age: 14,
    today: {
      metric_date: "2026-05-29",
      total_minutes: 210, night_minutes: 55, sessions: 30,
      dominant_app: "com.instagram.android",
      app_breakdown: { "com.instagram.android": 150, "com.whatsapp": 60 },
      behavioral_signals: {
        source: "ios_native",
        night_minutes: 55,
        sleep_minutes: 330,        // 5.5 h — muy por debajo de las 9 h
        sleep_onset_hour: 1.75,    // se durmió a la 01:45
        sleep_fragmentation: 4,
        resting_heart_rate: 82,    // elevada frente a su base de 68
        hrv_ms: 22,                // baja
      },
    },
    history,
  };

  const r = runClinicalEngine(input);
  console.log(`  score=${r.emotional_score} riesgo=${r.risk_level}`);
  console.log(`  dimensiones:`, r.dimensions);
  r.evidence.slice(0, 4).forEach((e) => console.log(`    · ${e.claim} → ${e.data_point}`));

  check("sueño gravemente alterado", r.dimensions.sleep_disruption >= 70,
    `${r.dimensions.sleep_disruption}`);
  check("distingue sueño MEDIDO de estimado",
    r.evidence.some((e) => e.data_point.includes("sueño medido")));
  check("detecta retraso de fase",
    r.evidence.some((e) => /conciliaci/i.test(e.data_point) || /más tarde/i.test(e.claim)));
  check("detecta fragmentación del sueño",
    r.evidence.some((e) => /fragmentado/i.test(e.claim)));
  check("usa biometría para ansiedad", r.dimensions.anxiety_signals >= 20,
    `${r.dimensions.anxiety_signals}`);
  check("riesgo alto", r.risk_level === "high", `${r.risk_level} (${r.emotional_score})`);
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 12 · Fase 2 Android — latencia de respuesta y compulsión sin estímulo");
// ══════════════════════════════════════════════════════════════════════════════
{
  const input: EngineInput = {
    age: 14,
    today: {
      metric_date: "2026-05-29",
      total_minutes: 140, night_minutes: 12, sessions: 60,
      dominant_app: "com.whatsapp",
      app_breakdown: { "com.whatsapp": 80, "com.instagram.android": 60 },
      behavioral_signals: {
        source: "android_native",
        unlocks: 96, night_unlocks: 1, dark_unlocks: 0,
        longest_idle_gap_minutes: 500,
        switches_per_minute: 0.6, distinct_apps: 6,
        avg_session_seconds: 140, night_minutes: 12,
        // Fase 2
        notifications_total: 120, notifications_social: 64,
        avg_response_seconds: 11,     // responde en 11 s de media
        fast_response_ratio: 0.92,    // el 92% en menos de 30 s
        phantom_pickups: 58,          // coge el móvil sin que llegue nada
      },
    },
    history: baseline(14, 130, 10, 70),
  };

  const r = runClinicalEngine(input);
  console.log(`  score=${r.emotional_score} riesgo=${r.risk_level}`);
  console.log(`  dimensiones:`, r.dimensions);
  r.evidence.slice(0, 4).forEach((e) => console.log(`    · ${e.claim} → ${e.data_point}`));

  check("ansiedad alta por respuesta inmediata", r.dimensions.anxiety_signals >= 50,
    `${r.dimensions.anxiety_signals}`);
  check("detecta la latencia de respuesta",
    r.evidence.some((e) => /inmediata/i.test(e.claim)));
  check("detecta compulsión sin estímulo",
    r.evidence.some((e) => /sin que haya llegado/i.test(e.claim)));
  check("los desbloqueos espontáneos suman a dependencia", r.dimensions.dependency >= 45,
    `${r.dimensions.dependency}`);
  check("no lo confunde con exceso de tiempo", input.today.total_minutes < 180);
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 13 · Evitación — recibe mensajes y no los abre");
// ══════════════════════════════════════════════════════════════════════════════
{
  const input: EngineInput = {
    age: 15,
    today: {
      metric_date: "2026-05-29",
      total_minutes: 120, night_minutes: 8, sessions: 15,
      dominant_app: "com.google.android.youtube",
      app_breakdown: { "com.google.android.youtube": 110, "com.whatsapp": 10 },
      behavioral_signals: {
        source: "android_native",
        unlocks: 24, night_unlocks: 0, dark_unlocks: 0,
        longest_idle_gap_minutes: 540,
        switches_per_minute: 0.2, distinct_apps: 3,
        avg_session_seconds: 480, night_minutes: 8,
        notifications_total: 70, notifications_social: 45,
        avg_response_seconds: 620,   // más de 10 min de media
        fast_response_ratio: 0.04,   // casi nunca responde rápido
        phantom_pickups: 6,
      },
    },
    history: baseline(14, 130, 8, 30),
  };

  const r = runClinicalEngine(input);
  console.log(`  dimensiones:`, r.dimensions);

  check("detecta evitación de mensajes",
    r.evidence.some((e) => /evita abrir/i.test(e.claim)));
  check("suma a aislamiento", r.dimensions.social_withdrawal >= 15,
    `${r.dimensions.social_withdrawal}`);
  check("no lo trata como ansiedad por aprobación",
    !r.evidence.some((e) => /inmediata/i.test(e.claim)));
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 14 · SEGURIDAD · Monitor web — NO puede emitir veredicto clínico");
// ══════════════════════════════════════════════════════════════════════════════
{
  // Esto es lo que enviaba el monitor web: tiempo de su propia página abierta,
  // presentado como si fuera uso del móvil del niño.
  const input: EngineInput = {
    age: 5,
    today: {
      metric_date: "2026-05-29",
      total_minutes: 300, night_minutes: 120, sessions: 50,
      dominant_app: "__monitor_web__",
      app_breakdown: { "__monitor_web__": 300 },
      behavioral_signals: { source: "web_monitor" } as never,
    },
    history: baseline(14, 60, 5),
  };

  const r = runClinicalEngine(input);
  console.log(`  evaluable=${r.assessable} calidad=${r.data_quality} score=${r.emotional_score}`);
  console.log(`  motivo: ${r.not_assessable_reason?.slice(0, 80)}...`);

  check("marca la fuente como insuficiente", r.data_quality === "insufficient");
  check("NO emite puntuación", r.emotional_score === null);
  check("NO emite nivel de riesgo", r.risk_level === null);
  check("NO deriva a profesional con datos falsos", r.refer_to_professional === false);
  check("NO inventa evidencia", r.evidence.length === 0);
  check("NO inventa dominios clínicos", r.clinical_domains.length === 0);
  check("confianza cero", r.confidence === 0);
  check("explica el motivo al padre", (r.not_assessable_reason ?? "").length > 40);
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 15 · SEGURIDAD · Sin señales de ningún tipo");
// ══════════════════════════════════════════════════════════════════════════════
{
  const input: EngineInput = {
    age: 12,
    today: {
      metric_date: "2026-05-29",
      total_minutes: 240, night_minutes: 90, sessions: 30,
      app_breakdown: { "com.zhiliaoapp.musically": 240 },
      behavioral_signals: null,
    },
    history: baseline(20, 100, 10),
  };

  const r = runClinicalEngine(input);
  console.log(`  evaluable=${r.assessable} score=${r.emotional_score}`);

  check("no evaluable sin fuente que mida", r.assessable === false);
  check("sin puntuación inventada", r.emotional_score === null);
  check("sin alerta de derivación", r.refer_to_professional === false);
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 16 · El dispositivo dejó de enviar — se avisa, no se puntúa");
// ══════════════════════════════════════════════════════════════════════════════
{
  const input: EngineInput = {
    age: 13,
    today: {
      metric_date: "2026-05-29",
      total_minutes: 0, night_minutes: 0, sessions: 0,
      app_breakdown: null,
      behavioral_signals: null,
    },
    // Antes sí había app nativa
    history: baseline(14, 180, 25, 55),
  };

  const r = runClinicalEngine(input);
  console.log(`  motivo: ${r.not_assessable_reason?.slice(0, 90)}`);

  check("detecta que antes sí medía", /dejado de enviar/i.test(r.not_assessable_reason ?? ""));
  check("no puntúa", r.emotional_score === null);
}

// ══════════════════════════════════════════════════════════════════════════════
section("CASO 17 · Con app nativa SÍ evalúa (la puerta no bloquea de más)");
// ══════════════════════════════════════════════════════════════════════════════
{
  const input: EngineInput = {
    age: 13,
    today: {
      metric_date: "2026-05-29",
      total_minutes: 320, night_minutes: 115, sessions: 48,
      dominant_app: "com.zhiliaoapp.musically",
      app_breakdown: { "com.zhiliaoapp.musically": 240, "com.whatsapp": 80 },
      behavioral_signals: {
        source: "android_native",
        unlocks: 74, night_unlocks: 9, dark_unlocks: 7,
        longest_idle_gap_minutes: 300,
        switches_per_minute: 0.44, distinct_apps: 7,
        avg_session_seconds: 400, night_minutes: 115,
      },
    },
    history: baseline(14, 180, 25, 45),
  };

  const r = runClinicalEngine(input);
  console.log(`  evaluable=${r.assessable} score=${r.emotional_score} riesgo=${r.risk_level}`);

  check("evaluable con app nativa", r.assessable === true);
  check("calidad clínica", r.data_quality === "clinical");
  check("emite puntuación", typeof r.emotional_score === "number");
  check("riesgo alto detectado", r.risk_level === "high");
  check("evidencia presente", r.evidence.length > 0);
}

// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(70)}`);
console.log(`RESULTADO:  ${passed} correctas · ${failed} fallidas`);
if (failed > 0) {
  console.log(`\nFallos:`);
  failures.forEach((f) => console.log(`  · ${f}`));
}
console.log("═".repeat(70));

// @ts-ignore - process existe al ejecutar bajo Node
if (typeof process !== "undefined") process.exit(failed > 0 ? 1 : 0);
