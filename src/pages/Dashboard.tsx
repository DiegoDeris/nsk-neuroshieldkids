import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { Plus, Brain, AlertTriangle, TrendingUp, Sparkles, Activity, Wifi, WifiOff, ChevronRight } from "lucide-react";
import { riskColor } from "@/lib/scoring";

type Child = { id: string; name: string; age: number; avatar_emoji: string | null; last_ingest_at?: string | null };
type Score = { score: number; risk_level: "low"|"medium"|"high"; created_at: string; explanation?: string | null };

const RISK_STYLE = {
  low:    { bg: "bg-emerald-50 dark:bg-emerald-950/20", border: "border-emerald-200 dark:border-emerald-800", dot: "bg-emerald-500", label: "text-emerald-700 dark:text-emerald-300" },
  medium: { bg: "bg-amber-50 dark:bg-amber-950/20",   border: "border-amber-200 dark:border-amber-800",   dot: "bg-amber-500",   label: "text-amber-700 dark:text-amber-300"   },
  high:   { bg: "bg-red-50 dark:bg-red-950/20",       border: "border-red-200 dark:border-red-800",       dot: "bg-red-500",     label: "text-red-700 dark:text-red-300"       },
};

function LiveDot({ active }: { active: boolean }) {
  if (!active) return <WifiOff className="h-3 w-3 text-muted-foreground" />;
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
    </span>
  );
}

const Dashboard = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [children, setChildren] = useState<Child[]>([]);
  const [latest, setLatest] = useState<Record<string, Score | null>>({});
  const [alertsCount, setAlertsCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: kids } = await supabase.from("children").select("*").eq("parent_id", user.id).order("created_at");
      setChildren(kids ?? []);
      const kidIds = (kids ?? []).map(k => k.id);
      const map: Record<string, Score | null> = {};
      if (kidIds.length > 0) {
        const scoreResults = await Promise.all(
          kidIds.map(kid =>
            supabase.from("emotional_scores")
              .select("score,risk_level,created_at,explanation")
              .eq("child_id", kid)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
              .then(({ data }) => ({ kid, data }))
          )
        );
        for (const { kid, data } of scoreResults) {
          map[kid] = data as any ?? null;
        }
      }
      setLatest(map);
      const { count } = await supabase.from("alerts").select("id", { count: "exact", head: true }).eq("read", false);
      setAlertsCount(count ?? 0);
      setLoading(false);
    })();
  }, [user]);

  // Realtime: actualiza badge de alertas y last_ingest_at
  useEffect(() => {
    const channel = supabase
      .channel("dashboard-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, async () => {
        const { count } = await supabase.from("alerts").select("id", { count: "exact", head: true }).eq("read", false);
        setAlertsCount(count ?? 0);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "children" }, async () => {
        const { data: kids } = await supabase.from("children").select("*").eq("parent_id", user?.id ?? "").order("created_at");
        setChildren(kids ?? []);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "emotional_scores" }, async (payload: any) => {
        const childId = payload.new?.child_id;
        if (!childId) return;
        const { data } = await supabase.from("emotional_scores")
          .select("score,risk_level,created_at,explanation")
          .eq("child_id", childId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        setLatest(prev => ({ ...prev, [childId]: data as any ?? null }));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const scores = Object.values(latest).filter(Boolean) as Score[];
  const avg = scores.reduce((a, s) => a + s.score, 0) / Math.max(1, scores.length);
  const highRiskCount = scores.filter(s => s.risk_level === "high").length;
  const liveCount = children.filter(c => c.last_ingest_at && Date.now() - new Date(c.last_ingest_at).getTime() < 5 * 60 * 1000).length;

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">{t("dashboard.hello")}</h1>
            <p className="text-muted-foreground">{t("dashboard.summary")}</p>
          </div>
          <Link to="/children"><Button><Plus className="h-4 w-4 mr-2" /> {t("dashboard.addChild")}</Button></Link>
        </div>

        {/* NSK value prop banner — sólo cuando hay hijos */}
        {children.length > 0 && (
          <Card className="p-5 gradient-card shadow-soft border-primary/20 overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-secondary/5 pointer-events-none" />
            <div className="relative flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Brain className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <div className="font-semibold flex items-center gap-2">
                    IA · Monitorización activa en tiempo real
                    {liveCount > 0 && (
                      <Badge variant="outline" className="border-emerald-400 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 text-xs gap-1 py-0.5">
                        <LiveDot active /> {liveCount} en vivo
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">Lectura de patrones de uso · Estado emocional · Alertas predictivas</p>
                </div>
              </div>
              {highRiskCount > 0 && (
                <Link to="/alerts">
                  <Badge variant="destructive" className="text-sm px-3 py-1.5 animate-pulse">
                    <AlertTriangle className="h-3 w-3 mr-1" /> {highRiskCount} en riesgo alto
                  </Badge>
                </Link>
              )}
            </div>
          </Card>
        )}

        {/* Stat cards */}
        <div className="grid sm:grid-cols-3 gap-4">
          <Card className="p-5 gradient-card shadow-soft">
            <div className="flex items-center gap-3 text-sm text-muted-foreground"><Brain className="h-4 w-4 text-primary" /> {t("dashboard.avgScore")}</div>
            <div className="text-4xl font-bold mt-2">{children.length ? Math.round(avg || 0) : "—"}</div>
            {scores.length > 0 && (
              <div className="text-xs text-muted-foreground mt-1">
                {scores.filter(s => s.risk_level === "low").length} tranquilos · {scores.filter(s => s.risk_level === "medium").length} atención · {scores.filter(s => s.risk_level === "high").length} alerta
              </div>
            )}
          </Card>
          <Card className="p-5 gradient-card shadow-soft">
            <div className="flex items-center gap-3 text-sm text-muted-foreground"><AlertTriangle className="h-4 w-4 text-warning" /> {t("dashboard.activeAlerts")}</div>
            <div className="text-4xl font-bold mt-2">{alertsCount}</div>
            {alertsCount > 0 && <Link to="/alerts" className="text-xs text-primary hover:underline mt-1 block">Ver alertas →</Link>}
          </Card>
          <Card className="p-5 gradient-card shadow-soft">
            <div className="flex items-center gap-3 text-sm text-muted-foreground"><Activity className="h-4 w-4 text-secondary" /> Dispositivos activos</div>
            <div className="text-4xl font-bold mt-2">{liveCount}<span className="text-xl text-muted-foreground font-normal">/{children.length}</span></div>
            <div className="text-xs text-muted-foreground mt-1">{liveCount > 0 ? "Datos llegando en tiempo real" : "Esperando conexión"}</div>
          </Card>
        </div>

        {loading ? (
          <div className="text-muted-foreground">{t("common.loading")}</div>
        ) : children.length === 0 ? (
          <Card className="p-10 text-center gradient-card border-dashed">
            <Sparkles className="h-10 w-10 mx-auto text-primary mb-3" />
            <h2 className="text-xl font-semibold mb-2">{t("dashboard.emptyTitle")}</h2>
            <p className="text-muted-foreground mb-6">{t("dashboard.emptyText")}</p>
            <Link to="/children"><Button size="lg"><Plus className="h-4 w-4 mr-2" /> {t("dashboard.addChild")}</Button></Link>
          </Card>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Estado emocional · hijos</h2>
              <Link to="/children" className="text-xs text-primary hover:underline flex items-center gap-0.5">
                Gestionar <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {children.map(c => {
                const s = latest[c.id];
                const style = s ? RISK_STYLE[s.risk_level] : null;
                const isLive = !!c.last_ingest_at && Date.now() - new Date(c.last_ingest_at).getTime() < 5 * 60 * 1000;
                const isConnected = !!c.last_ingest_at;
                return (
                  <Link key={c.id} to={`/child/${c.id}`}>
                    <Card className={`p-5 hover:shadow-glow transition-smooth cursor-pointer h-full border ${style ? `${style.bg} ${style.border}` : ""}`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="text-3xl">{c.avatar_emoji}</div>
                          <div>
                            <div className="font-semibold">{c.name}</div>
                            <div className="text-xs text-muted-foreground">{t("dashboard.yearsOld", { age: c.age })}</div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {s ? (
                            <div className={`text-3xl font-bold ${style ? style.label : ""}`}>{s.score}</div>
                          ) : (
                            <div className="text-xs text-muted-foreground">{t("dashboard.noData")}</div>
                          )}
                          <div className="flex items-center gap-1">
                            <LiveDot active={isLive} />
                            {!isConnected && <span className="text-[10px] text-muted-foreground">Sin conectar</span>}
                          </div>
                        </div>
                      </div>
                      {s && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${style?.dot}`} />
                            <span className={`text-xs font-semibold ${style?.label}`}>
                              {s.risk_level === "low" ? "Tranquilo" : s.risk_level === "medium" ? "Atención" : "Alerta"}
                            </span>
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              {new Date(s.created_at).toLocaleDateString("es", { day: "2-digit", month: "short" })}
                            </span>
                          </div>
                          {s.explanation && (
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{s.explanation}</p>
                          )}
                        </div>
                      )}
                      {!s && isConnected && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                          <TrendingUp className="h-3 w-3" /> Ejecuta el análisis profundo
                        </div>
                      )}
                    </Card>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default Dashboard;
