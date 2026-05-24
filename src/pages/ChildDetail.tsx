import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { useParams, Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { computeEmotionalScore, computeScoreWithHistory, riskLabel, hoursAgo } from "@/lib/scoring";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, PieChart, Pie, Cell } from "recharts";
import { Brain, FileDown, Sparkles, ArrowLeft, Trophy, AlertTriangle, TrendingUp, Phone, MessageSquare, Target, Clock, Moon, Activity, Smartphone, CheckCircle2, ChevronDown } from "lucide-react";
import { QuickConnect } from "@/components/QuickConnect";

const DIM_LABELS: Record<string, string> = {
  sleep_disruption: "Sueño",
  anxiety_signals: "Ansiedad",
  mood_volatility: "Ánimo",
  social_withdrawal: "Aislamiento",
  dependency: "Dependencia",
  attention_fragmentation: "Atención",
};

const PIE_COLORS = ["#6366f1","#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899","#14b8a6","#f97316","#a855f7"];

/** Corrige mojibake UTF-8→Latin-1: texto almacenado como bytes UTF-8 interpretados como Latin-1. */
function fixMojibake(s: string | null | undefined): string {
  if (!s) return s ?? "";
  // Si hay chars > 255 ya es Unicode correcto
  if ([...s].some(c => c.charCodeAt(0) > 255)) return s;
  try {
    const bytes = new Uint8Array([...s].map(c => c.charCodeAt(0)));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return s;
  }
}

const ChildDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [child, setChild] = useState<any>(null);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [scores, setScores] = useState<any[]>([]);
  const [recs, setRecs] = useState<any[]>([]);
  const [game, setGame] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [predicting, setPredicting] = useState(false);
  const [coaching, setCoaching] = useState(false);
  const [prediction, setPrediction] = useState<any>(null);
  const [coachPlan, setCoachPlan] = useState<any>(null);
  const [showQR, setShowQR] = useState(false);

  const loadingRef = useRef(false);
  const lastAutoAnalyzeRef = useRef<string | null>(null);
  const loadAll = useCallback(async () => {
    if (!id) return;
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
    const [{ data: c }, { data: m }, { data: s }, { data: r }, { data: g }] = await Promise.all([
      supabase.from("children").select("*").eq("id", id).maybeSingle(),
      supabase.from("usage_metrics").select("*").eq("child_id", id).order("metric_date", { ascending: false }).limit(30),
      supabase.from("emotional_scores").select("*").eq("child_id", id).order("created_at", { ascending: false }).limit(14),
      supabase.from("recommendations").select("*").eq("child_id", id).order("created_at", { ascending: false }).limit(10),
      supabase.from("gamification").select("*").eq("child_id", id).maybeSingle(),
    ]);
    setChild(c); setMetrics(m ?? []); setScores(s ?? []); setRecs(r ?? []); setGame(g);
    } finally {
      loadingRef.current = false;
    }
  }, [id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Auto-análisis en vivo: cuando llegan métricas nuevas que no tienen análisis de hoy
  useEffect(() => {
    if (analyzing || !metrics[0]) return;
    // Clave: id + total_minutes para detectar tanto filas nuevas como actualizaciones por UPSERT
    const metricKey = `${metrics[0].id}_${metrics[0].total_minutes ?? 0}`;
    if (metricKey === lastAutoAnalyzeRef.current) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    const lastScoreDate = scores[0]?.created_at?.slice(0, 10);
    const lastScoreAge = scores[0] ? Date.now() - new Date(scores[0].created_at).getTime() : Infinity;
    const COOLDOWN = 15 * 60 * 1000;
    if (lastScoreDate === todayStr && lastScoreAge < COOLDOWN) return;
    lastAutoAnalyzeRef.current = metricKey;
    const t = setTimeout(() => analyze(), 1500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics[0]?.id, metrics[0]?.total_minutes]);

  // Realtime: refresca al instante cuando llegan datos del dispositivo / IA
  useEffect(() => {
    if (!id) return;
    let scheduled: ReturnType<typeof setTimeout> | null = null;
    const debouncedReload = () => {
      if (scheduled) clearTimeout(scheduled);
      scheduled = setTimeout(() => { loadAll(); }, 400);
    };
    const channel = supabase
      .channel(`child-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "emotional_scores", filter: `child_id=eq.${id}` }, debouncedReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "usage_metrics", filter: `child_id=eq.${id}` }, debouncedReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "recommendations", filter: `child_id=eq.${id}` }, debouncedReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "children", filter: `id=eq.${id}` }, debouncedReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "gamification", filter: `child_id=eq.${id}` }, debouncedReload)
      .subscribe();
    return () => {
      if (scheduled) clearTimeout(scheduled);
      supabase.removeChannel(channel);
    };
  }, [id, loadAll]);

  // Reintento online: si el usuario recupera la conexión, recargamos
  useEffect(() => {
    const onOnline = () => { toast.success("Conexión recuperada"); loadAll(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [loadAll]);

  const trendData = useMemo(() => [...scores].reverse().map(s => ({
    date: new Date(s.created_at).toLocaleDateString("es", { day: "2-digit", month: "2-digit" }),
    score: s.score
  })), [scores]);

  const radarData = useMemo(() => {
    const last = metrics[0];
    if (!last) return [];
    const breakdown = (last.app_breakdown ?? {}) as Record<string, number>;
    return Object.entries(breakdown).slice(0, 6).map(([app, m]) => ({ app, minutos: m }));
  }, [metrics]);

  const lastScore = scores[0];
  const ai = (lastScore?.patterns && typeof lastScore.patterns === "object" && !Array.isArray(lastScore.patterns)) ? lastScore.patterns as any : null;

  const isLive = !!child?.last_ingest_at && Date.now() - new Date(child.last_ingest_at).getTime() < 5 * 60 * 1000;
  const isConnected = !!child?.last_ingest_at;

  const [aiDeep, setAiDeep] = useState<any>(null);

  const analyze = async () => {
    if (!metrics[0]) return toast.error("Añade primero las métricas del día");
    setAnalyzing(true);
    try {
      const last = metrics[0];
      const prev_avg = metrics.slice(1, 8).reduce((a, m) => a + m.total_minutes, 0) / Math.max(1, metrics.slice(1, 8).length);
      // v2: scoring con momentum temporal usando historial de métricas
      const historyPoints = metrics.slice(1, 15).map((m: any) => ({
        total_minutes: m.total_minutes, night_minutes: m.night_minutes, sessions: m.sessions
      }));
      const heuristic = computeScoreWithHistory({
        total_minutes: last.total_minutes, night_minutes: last.night_minutes,
        sessions: last.sessions, dominant_app: last.dominant_app,
        app_breakdown: last.app_breakdown, prev_week_avg_minutes: prev_avg,
      }, historyPoints);
      const history = metrics.slice(0, 14).map(m => ({ d: m.metric_date, t: m.total_minutes, n: m.night_minutes, s: m.sessions }));

      const { data, error } = await supabase.functions.invoke("analyze-emotional", {
        body: { child, metric: last, heuristic, history }
      });
      if (error) throw error;
      if ((data as any).error) throw new Error((data as any).error);
      const a = data as any;
      setAiDeep(a);

      // Persistimos el análisis enriquecido dentro de patterns (jsonb) para no migrar esquema
      await supabase.from("emotional_scores").insert([{
        child_id: id!, parent_id: user!.id,
        score: a.emotional_score, risk_level: a.risk_level,
        patterns: {
          summary_patterns: a.detected_patterns,
          dimensions: a.dimensions,
          confidence: a.confidence,
          severity_tier: a.severity_tier,
          evidence: a.evidence,
          conversation_script: a.conversation_script,
          refer_to_professional: a.refer_to_professional,
          referral_reason: a.referral_reason,
          immediate_actions: a.immediate_actions,
          long_term_actions: a.long_term_actions,
        },
        explanation: a.explanation,
        actions: a.actions,
        source_metric_id: last.id,
      }]);

      if (Array.isArray(a.actions)) {
        await supabase.from("recommendations").insert(
          a.actions.map((x: string) => ({ child_id: id!, parent_id: user!.id, title: x, body: a.explanation, category: a.risk_level }))
        );
      }

      const sevMap: any = { critical: "critical", moderate: "moderate", watch: "moderate", preventive: "preventive" };
      if (a.refer_to_professional || a.severity_tier === "critical" || a.emotional_score > 60) {
        await supabase.from("alerts").insert([{
          child_id: id!, parent_id: user!.id,
          severity: sevMap[a.severity_tier] ?? "moderate",
          title: a.refer_to_professional ? `⚠️ Recomendada ayuda profesional para ${child.name}` : `Score ${a.emotional_score} en ${child.name}`,
          message: a.refer_to_professional ? `${a.referral_reason}\n\n${a.explanation}` : a.explanation,
        }]);
      }

      if (a.risk_level === "low") {
        const cur = game?.points ?? 0;
        const newPoints = cur + 10;
        const badges = (game?.badges ?? []) as string[];
        if (newPoints >= 50 && !badges.includes("🥉 Hábito saludable")) badges.push("🥉 Hábito saludable");
        if (newPoints >= 150 && !badges.includes("🥈 Constancia")) badges.push("🥈 Constancia");
        if (newPoints >= 300 && !badges.includes("🥇 Maestro digital")) badges.push("🥇 Maestro digital");
        await supabase.from("gamification").upsert([{
          child_id: id!, parent_id: user!.id, points: newPoints, badges
        }], { onConflict: "child_id" });
      }

      toast.success("Análisis IA multidimensional completado ✨");
      await loadAll();
    } catch (e: any) {
      toast.error(e.message ?? "Error en análisis IA");
    } finally {
      setAnalyzing(false);
    }
  };

  const predict = useCallback(async (attempt = 0) => {
    setPredicting(true);
    try {
      if (!navigator.onLine) throw new Error("Sin conexión. Reintenta cuando vuelvas a tener internet.");
      if (!metrics[0] && scores.length === 0) {
        throw new Error("Aún no hay datos suficientes. Conecta el dispositivo y vuelve a intentarlo.");
      }
      const { data, error } = await supabase.functions.invoke("predict-trends", { body: { child_id: id } });
      if (error) {
        // Intenta leer mensaje legible del cuerpo del error
        let msg = error.message || "Error de red";
        try {
          const ctx: any = (error as any).context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            if (body?.error) msg = body.error;
          }
        } catch { /* noop */ }
        if (msg === "auth") msg = "Sesión caducada. Vuelve a iniciar sesión.";
        if (msg === "forbidden") msg = "No tienes acceso a este perfil.";
        if (/Rate limit/i.test(msg)) msg = "Demasiadas peticiones. Espera un momento.";
        if (/saldo IA/i.test(msg)) msg = "Sin créditos de IA disponibles.";
        throw new Error(msg);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      setPrediction(data);
      toast.success("Predicción IA generada ✨");
    } catch (e: any) {
      const isNet = /Failed to fetch|NetworkError|load failed/i.test(e?.message ?? "");
      if (isNet && attempt < 2) {
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        return predict(attempt + 1);
      }
      toast.error(e?.message ?? "No se pudo generar la predicción");
    } finally {
      setPredicting(false);
    }
  }, [id, metrics, scores.length]);

  const coach = async () => {
    setCoaching(true);
    try {
      const { data, error } = await supabase.functions.invoke("prevention-coach", { body: { child_id: id } });
      if (error) throw error;
      if ((data as any).error) throw new Error((data as any).error);
      setCoachPlan(data);
      toast.success("Plan semanal creado ✨");
    } catch (e: any) { toast.error(e.message ?? "Error"); }
    finally { setCoaching(false); }
  };

  // Reconstruimos análisis profundo desde el último score guardado si no hay live
  const deep = aiDeep ?? (ai && ai.dimensions ? {
    emotional_score: lastScore?.score, risk_level: lastScore?.risk_level,
    explanation: lastScore?.explanation,
    detected_patterns: ai.summary_patterns,
    dimensions: ai.dimensions, confidence: ai.confidence,
    severity_tier: ai.severity_tier, evidence: ai.evidence,
    conversation_script: ai.conversation_script,
    refer_to_professional: ai.refer_to_professional,
    referral_reason: ai.referral_reason,
    immediate_actions: ai.immediate_actions,
    long_term_actions: ai.long_term_actions,
  } : null);

  const downloadReport = () => {
    const lines = [
      `Informe NeuroShield Kids - ${child?.name}`,
      `Generado: ${new Date().toLocaleString("es")}`,
      `\n== Últimos scores ==`,
      ...scores.slice(0, 10).map(s => `${new Date(s.created_at).toLocaleDateString("es")} · Score ${s.score} (${s.risk_level}) - ${s.explanation ?? ""}`),
      `\n== Últimas métricas ==`,
      ...metrics.slice(0, 10).map(m => `${m.metric_date} · ${m.total_minutes} min · noche ${m.night_minutes} min · ${m.sessions} sesiones · app: ${m.dominant_app ?? "n/d"}`),
    ].join("\n");
    const blob = new Blob([lines], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `informe-${child?.name}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!child) return <AppLayout><div className="text-muted-foreground">Cargando…</div></AppLayout>;

  return (
    <AppLayout>
      <div className="space-y-6">
        <Link to="/dashboard" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4 mr-1" /> Dashboard</Link>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="text-5xl">{child.avatar_emoji}</div>
            <div>
              <h1 className="text-3xl font-bold">{child.name}</h1>
              <p className="text-muted-foreground">{child.age} años</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={analyze} disabled={analyzing} size="lg" className="shadow-glow rounded-full">
              <Sparkles className="h-4 w-4 mr-2" /> {analyzing ? "Analizando…" : "Análisis profundo"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => predict()} disabled={predicting}>
              <TrendingUp className="h-4 w-4 mr-2" /> {predicting ? "Prediciendo…" : "Predecir"}
            </Button>
            <Button variant="ghost" size="sm" onClick={coach} disabled={coaching}>
              <Target className="h-4 w-4 mr-2" /> {coaching ? "Generando…" : "Plan semanal"}
            </Button>
            <Button variant="ghost" size="sm" onClick={downloadReport}><FileDown className="h-4 w-4 mr-2" /> Reporte</Button>
          </div>
        </div>

        {/* Conexión: badge colapsado si ya está conectado, QR completo si no */}
        {isConnected && !showQR ? (
          <Card className="p-4 rounded-2xl shadow-soft border-green-200 bg-green-50/60 dark:bg-green-950/20 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-green-100 dark:bg-green-900/40 inline-flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <div className="font-semibold text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
                  Conectado ✓ {isLive && <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />}
                </div>
                <div className="text-xs text-muted-foreground">
                  Última señal: {child.last_ingest_at ? new Date(child.last_ingest_at).toLocaleString() : "—"}
                </div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowQR(true)}>
              <ChevronDown className="h-4 w-4 mr-1" /> Mostrar QR
            </Button>
          </Card>
        ) : (
          <div className="space-y-2">
            {isConnected && (
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowQR(false)}>Ocultar QR</Button>
              </div>
            )}
            <QuickConnect child={child} onChange={loadAll} />
          </div>
        )}

        {/* Semáforo global de bienestar */}
        <SemaphoreCard risk={lastScore?.risk_level} score={lastScore?.score} />

        {/* Radar de apps justo debajo del semáforo */}
        <PremiumRadarCard data={radarData} />

        {/* Uso de hoy en tarjetas de solo lectura (dashboard, no formulario) */}
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Uso de hoy
          </h2>
          {metrics[0] ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <ReadOnlyMetric icon={<Clock className="h-4 w-4" />} label="Tiempo total" value={`${metrics[0].total_minutes} min`} />
              <ReadOnlyMetric icon={<Moon className="h-4 w-4" />} label="Uso nocturno" value={`${metrics[0].night_minutes} min`} hint="22h - 7h" />
              <ReadOnlyMetric icon={<Activity className="h-4 w-4" />} label="Sesiones" value={`${metrics[0].sessions}`} />
              <ReadOnlyMetric icon={<Smartphone className="h-4 w-4" />} label="App favorita" value={metrics[0].dominant_app ?? "—"} />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[0,1,2,3].map(i => (
                <Card key={i} className="p-4 rounded-2xl shadow-soft">
                  <Skeleton className="h-3 w-20 mb-3" />
                  <Skeleton className="h-7 w-16" />
                  <p className="text-[11px] text-muted-foreground mt-3">Esperando datos del dispositivo…</p>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Derivación profesional */}
        {deep?.refer_to_professional && (
          <Card className="p-5 border-destructive/40 bg-destructive/5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-6 w-6 text-destructive shrink-0" />
              <div className="space-y-3">
                <div>
                  <h3 className="font-semibold text-destructive">Recomendamos buscar apoyo profesional</h3>
                  <p className="text-sm text-muted-foreground mt-1">{deep.referral_reason}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href="tel:900202010"><Button size="sm" variant="destructive"><Phone className="h-4 w-4 mr-2" /> ANAR 900 20 20 10</Button></a>
                  <a href="tel:024"><Button size="sm" variant="outline"><Phone className="h-4 w-4 mr-2" /> 024 conducta suicida</Button></a>
                  <a href="tel:017"><Button size="sm" variant="outline"><Phone className="h-4 w-4 mr-2" /> INCIBE 017</Button></a>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Score actual + tendencia */}
        <div className="grid md:grid-cols-3 gap-4">
          <Card className="p-6 rounded-2xl shadow-soft md:col-span-1">
            <div className="text-sm text-muted-foreground flex items-center gap-2"><Brain className="h-4 w-4 text-primary" /> Último score</div>
            {lastScore ? (
              <>
                <div className="text-6xl font-extrabold mt-2 text-gradient">{lastScore.score}</div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Badge variant={lastScore.risk_level === "high" ? "destructive" : "secondary"}>
                    {riskLabel(lastScore.risk_level)}
                  </Badge>
                  {deep?.confidence != null && (
                    <Badge variant="outline">Confianza {deep.confidence}%</Badge>
                  )}
                  {hoursAgo(lastScore.created_at) > 24 && (
                    <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
                      ⚠️ Hace {Math.round(hoursAgo(lastScore.created_at))}h — actualiza el análisis
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-3">{fixMojibake(lastScore.explanation)}</p>
              </>
            ) : (
              <div className="mt-4 space-y-2">
                <Skeleton className="h-12 w-24" />
                <Skeleton className="h-3 w-32" />
                <p className="text-xs text-muted-foreground pt-1">Esperando datos del dispositivo…</p>
              </div>
            )}
          </Card>

          <PremiumTrendCard data={trendData} />
        </div>

        {/* Análisis multidimensional */}
        {deep?.dimensions && (
          <Card className="p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2"><Brain className="h-4 w-4 text-primary" /> Dimensiones del bienestar</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              {Object.entries(deep.dimensions as Record<string, number>).map(([k, v]) => (
                <div key={k} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{DIM_LABELS[k] ?? k}</span>
                    <span className={v >= 70 ? "text-destructive font-semibold" : v >= 40 ? "text-warning font-semibold" : "text-muted-foreground"}>{v}</span>
                  </div>
                  <Progress value={v} className="h-2" />
                </div>
              ))}
            </div>

            {Array.isArray(deep.evidence) && deep.evidence.length > 0 && (
              <div className="mt-6">
                <h4 className="text-sm font-semibold mb-2">Evidencia detectada</h4>
                <ul className="space-y-2">
                  {deep.evidence.map((e: any, i: number) => (
                    <li key={i} className="text-sm p-3 rounded-lg bg-muted/40">
                      <div>{fixMojibake(e.claim)}</div>
                      <div className="text-xs text-muted-foreground mt-1">📊 {fixMojibake(e.data_point)}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4 mt-6">
              {Array.isArray(deep.immediate_actions) && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Para HOY</h4>
                  <ul className="space-y-2">
                    {deep.immediate_actions.map((a: string, i: number) => (
                      <li key={i} className="text-sm flex gap-2"><Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />{fixMojibake(a)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {Array.isArray(deep.long_term_actions) && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Para 2-4 semanas</h4>
                  <ul className="space-y-2">
                    {deep.long_term_actions.map((a: string, i: number) => (
                      <li key={i} className="text-sm flex gap-2"><Target className="h-4 w-4 text-secondary shrink-0 mt-0.5" />{fixMojibake(a)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {Array.isArray(deep.conversation_script) && deep.conversation_script.length > 0 && (
              <div className="mt-6 p-4 rounded-lg bg-primary/5 border border-primary/20">
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" /> Cómo hablarlo con tu hijo/a</h4>
                <ul className="space-y-1 text-sm italic">
                  {deep.conversation_script.map((c: string, i: number) => <li key={i}>"{fixMojibake(c)}"</li>)}
                </ul>
              </div>
            )}
          </Card>
        )}

        {/* Predicción multi-horizonte */}
        {prediction && (
          <Card className="p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-secondary" /> Predicción IA · calidad de datos: {prediction.data_quality}</h3>
            <div className="grid sm:grid-cols-3 gap-3">
              {(prediction.horizons ?? []).map((h: any) => (
                <div key={h.days} className="p-4 rounded-lg bg-muted/40">
                  <div className="text-xs text-muted-foreground">A {h.days} días</div>
                  <div className="text-3xl font-bold mt-1">{h.expected_score}</div>
                  <div className="text-xs text-muted-foreground">rango {h.low_score}–{h.high_score}</div>
                  <Badge className="mt-2" variant={h.risk_level === "high" ? "destructive" : "secondary"}>{h.trend}</Badge>
                </div>
              ))}
            </div>
            <div className="grid md:grid-cols-2 gap-3 mt-4">
              <div className="p-4 rounded-lg border border-success/30 bg-success/5">
                <div className="text-sm font-semibold">Con plan de prevención</div>
                <div className="text-2xl font-bold mt-1">{prediction.scenario_with_intervention?.expected_score_7d}</div>
                <div className="text-xs text-muted-foreground mt-1">{prediction.scenario_with_intervention?.rationale}</div>
              </div>
              <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/5">
                <div className="text-sm font-semibold">Sin intervención</div>
                <div className="text-2xl font-bold mt-1">{prediction.scenario_no_intervention?.expected_score_7d}</div>
                <div className="text-xs text-muted-foreground mt-1">{prediction.scenario_no_intervention?.rationale}</div>
              </div>
            </div>
            {Array.isArray(prediction.early_warning_signals) && (
              <div className="mt-4">
                <h4 className="text-sm font-semibold mb-2">Indicadores tempranos a vigilar</h4>
                <ul className="space-y-2">
                  {prediction.early_warning_signals.map((s: any, i: number) => (
                    <li key={i} className="text-sm p-3 rounded-lg bg-muted/40">
                      <div className="font-medium">{s.signal}</div>
                      <div className="text-xs text-muted-foreground">⚠️ {s.threshold}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}

        {/* Plan semanal del coach */}
        {coachPlan && (
          <Card className="p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2"><Target className="h-4 w-4 text-primary" /> Plan semanal personalizado</h3>
            <div className="flex flex-wrap gap-2 mb-4">
              {(coachPlan.focus_areas ?? []).map((f: string, i: number) => <Badge key={i} variant="secondary">{f}</Badge>)}
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-semibold mb-2">KPIs medibles</h4>
                <ul className="space-y-2">
                  {(coachPlan.kpis ?? []).map((k: any, i: number) => (
                    <li key={i} className="text-sm p-3 rounded-lg bg-muted/40">
                      <div className="font-medium">{k.name}</div>
                      <div className="text-xs">🎯 {k.target}</div>
                      <div className="text-xs text-muted-foreground">📏 {k.how_to_measure}</div>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-sm font-semibold mb-2">Micro-hábitos diarios</h4>
                <ul className="space-y-1">
                  {(coachPlan.daily_micro_habits ?? []).map((h: any, i: number) => (
                    <li key={i} className="text-sm p-2 rounded bg-muted/30">
                      <span className="font-bold uppercase text-xs text-primary">{h.day}</span> · {h.habit}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-4 p-3 rounded-lg bg-success/5 border border-success/20 text-sm">
              ✅ <span className="font-semibold">Éxito si:</span> {coachPlan.success_criteria}
            </div>
            <div className="mt-2 p-3 rounded-lg bg-warning/5 border border-warning/20 text-sm">
              🔁 <span className="font-semibold">Si empeora:</span> {coachPlan.if_things_get_worse}
            </div>
          </Card>
        )}

        <Card className="p-6 rounded-2xl shadow-soft">
          <h3 className="font-semibold mb-3">Recomendaciones</h3>
          {recs.length === 0 ? (
            <div className="space-y-2">
              {[0,1,2].map(i => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
              <p className="text-xs text-muted-foreground pt-1">Esperando datos del dispositivo…</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {recs.map(r => (
                <li key={r.id} className="flex items-start gap-2 p-3 rounded-lg bg-muted/40">
                  <Sparkles className="h-4 w-4 text-primary mt-1 shrink-0" />
                  <span className="text-sm">{r.title}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Gamificación — sección separada al final, fuera de métricas parentales */}
        <section className="pt-6 mt-4 border-t">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Logros de {child.name}
          </h2>
          <Card className="p-6 rounded-2xl shadow-soft">
            <div className="flex items-center gap-2 text-secondary mb-2"><Trophy className="h-4 w-4" /> <span className="text-sm font-semibold">Gamificación</span></div>
            <div className="text-4xl font-extrabold text-gradient">{game?.points ?? 0} pts</div>
            <div className="flex flex-wrap gap-2 mt-3">
              {(game?.badges ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Aún sin medallas. ¡A por la primera!</p>
              ) : (game.badges as string[]).map(b => (
                <Badge key={b} variant="secondary" className="text-base py-1 px-3">{b}</Badge>
              ))}
            </div>
          </Card>
        </section>
      </div>
    </AppLayout>
  );
};

export default ChildDetail;

// ------------ Helpers visuales ------------

function WaitingSkeleton({ height = "h-32" }: { height?: string }) {
  return (
    <div className={`${height} w-full rounded-xl bg-muted/40 animate-pulse flex items-center justify-center`}>
      <span className="text-xs text-muted-foreground">Esperando datos del dispositivo…</span>
    </div>
  );
}

function ReadOnlyMetric({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4 rounded-2xl shadow-soft">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="text-primary">{icon}</span>{label}
      </div>
      <div className="text-2xl font-bold mt-2 tracking-tight">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </Card>
  );
}

function SemaphoreCard({ risk, score }: { risk?: "low" | "medium" | "high"; score?: number }) {
  const states = [
    { key: "low", label: "TRANQUILO", desc: "Todo va bien hoy", dot: "bg-green-500", ring: "ring-green-200", text: "text-green-700", bg: "bg-green-50/70 dark:bg-green-950/20", border: "border-green-200" },
    { key: "medium", label: "ATENCIÓN", desc: "Vigila el patrón de uso", dot: "bg-amber-500", ring: "ring-amber-200", text: "text-amber-700", bg: "bg-amber-50/70 dark:bg-amber-950/20", border: "border-amber-200" },
    { key: "high", label: "ALERTA", desc: "Conviene actuar pronto", dot: "bg-red-500", ring: "ring-red-200", text: "text-red-700", bg: "bg-red-50/70 dark:bg-red-950/20", border: "border-red-200" },
  ] as const;
  const active = states.find(s => s.key === risk);
  return (
    <Card className={`p-5 rounded-3xl shadow-soft border ${active ? `${active.bg} ${active.border}` : ""}`}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {states.map(s => (
              <span
                key={s.key}
                className={`h-4 w-4 rounded-full ${s.dot} ${active?.key === s.key ? `ring-4 ${s.ring}` : "opacity-25"}`}
              />
            ))}
          </div>
          <div>
            <div className={`text-xl font-extrabold tracking-tight ${active ? active.text : "text-muted-foreground"}`}>
              {active ? active.label : "SIN DATOS"}
            </div>
            <div className="text-sm text-muted-foreground">
              {active ? active.desc : "Aún no hay un análisis del estado emocional."}
            </div>
          </div>
        </div>
        {typeof score === "number" && (
          <div className="text-right">
            <div className="text-3xl font-extrabold tracking-tight">{score}</div>
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Índice de riesgo</div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ------------ Premium charts (Apple Health × Duolingo) ------------

const TrendTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const v = payload[0].value as number;
  const tone = v >= 70 ? "text-red-500" : v >= 40 ? "text-amber-500" : "text-emerald-500";
  return (
    <div className="rounded-xl border border-border/60 bg-background/95 backdrop-blur px-3 py-2 shadow-lg">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold ${tone}`}>{v}</div>
    </div>
  );
};

const PremiumTrendCard = memo(function PremiumTrendCard({ data }: { data: { date: string; score: number }[] }) {
  const last = data[data.length - 1]?.score;
  const prev = data[data.length - 2]?.score;
  const delta = last != null && prev != null ? last - prev : null;
  return (
    <Card className="p-6 rounded-3xl shadow-soft md:col-span-2 relative overflow-hidden bg-gradient-to-br from-background to-primary/5">
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Tendencia última semana</div>
          <div className="text-2xl font-extrabold tracking-tight mt-1">
            {last != null ? last : "—"}
            {delta != null && (
              <span className={`ml-2 text-sm font-semibold ${delta > 0 ? "text-red-500" : delta < 0 ? "text-emerald-500" : "text-muted-foreground"}`}>
                {delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {Math.abs(delta)}
              </span>
            )}
          </div>
        </div>
        <Badge variant="outline" className="rounded-full">Índice emocional</Badge>
      </div>
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="trendStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="hsl(var(--primary))" />
                <stop offset="100%" stopColor="hsl(var(--secondary))" />
              </linearGradient>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 6" vertical={false} opacity={0.4} />
            <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} width={28} />
            <Tooltip content={<TrendTooltip />} cursor={{ stroke: "hsl(var(--primary))", strokeWidth: 1, strokeOpacity: 0.3 }} />
            <Area
              type="monotone"
              dataKey="score"
              stroke="url(#trendStroke)"
              strokeWidth={3}
              fill="url(#trendFill)"
              dot={{ r: 3, fill: "hsl(var(--background))", stroke: "hsl(var(--primary))", strokeWidth: 2 }}
              activeDot={{ r: 6, fill: "hsl(var(--primary))", stroke: "hsl(var(--background))", strokeWidth: 3 }}
              isAnimationActive
              animationDuration={900}
              animationEasing="ease-out"
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <WaitingSkeleton height="h-[220px]" />
      )}
    </Card>
  );
});

const PremiumRadarCard = memo(function PremiumRadarCard({ data }: { data: { app: string; minutos: number }[] }) {
  const sorted = [...data].sort((a, b) => b.minutos - a.minutos);
  const top = sorted[0];
  const total = sorted.reduce((a, d) => a + d.minutos, 0);
  const pieData = sorted.map(d => ({ name: d.app, value: d.minutos }));

  const renderLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
    if (percent < 0.07) return null;
    const RADIAN = Math.PI / 180;
    const r = innerRadius + (outerRadius - innerRadius) * 0.55;
    const x = cx + r * Math.cos(-midAngle * RADIAN);
    const y = cy + r * Math.sin(-midAngle * RADIAN);
    return <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700}>{`${Math.round(percent * 100)}%`}</text>;
  };

  return (
    <Card className="p-6 rounded-3xl shadow-soft relative overflow-hidden bg-gradient-to-br from-background via-background to-secondary/5">
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Apps · último día</div>
          <h3 className="text-lg font-bold mt-1 flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            {top ? <>Domina <span className="text-gradient">{top.app}</span></> : "Uso por app"}
          </h3>
        </div>
        {total > 0 && <Badge variant="secondary" className="rounded-full">{total} min totales</Badge>}
      </div>
      {pieData.length > 0 ? (
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <ResponsiveContainer width={230} height={230}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%" cy="50%"
                innerRadius={58} outerRadius={105}
                paddingAngle={2}
                dataKey="value"
                labelLine={false}
                label={renderLabel}
                isAnimationActive
                animationDuration={900}
                animationEasing="ease-out"
              >
                {pieData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 12 }}
                formatter={(v: any) => [`${v} min`, "Uso"]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-col gap-2 min-w-0 flex-1 w-full">
            {pieData.map((d, i) => (
              <div key={d.name} className="flex items-center gap-2 text-sm min-w-0">
                <span className="h-3 w-3 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                <span className="truncate flex-1 text-muted-foreground">{d.name}</span>
                <span className="font-bold shrink-0 tabular-nums">{d.value}m</span>
                {total > 0 && (
                  <span className="text-xs text-muted-foreground shrink-0 w-8 text-right">{Math.round(d.value / total * 100)}%</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <WaitingSkeleton height="h-[240px]" />
      )}
    </Card>
  );
});
