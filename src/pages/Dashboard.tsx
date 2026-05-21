import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { Plus, Brain, AlertTriangle, TrendingUp, Sparkles } from "lucide-react";
import { riskColor } from "@/lib/scoring";

type Child = { id: string; name: string; age: number; avatar_emoji: string | null };
type Score = { score: number; risk_level: "low"|"medium"|"high"; created_at: string };

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
      // Batch: obtener último score de todos los hijos en paralelo en vez de loop serial
      const kidIds = (kids ?? []).map(k => k.id);
      const map: Record<string, Score | null> = {};
      if (kidIds.length > 0) {
        // Una sola query por hijo usando Promise.all (paralelo, no serial)
        const scoreResults = await Promise.all(
          kidIds.map(kid =>
            supabase.from("emotional_scores")
              .select("score,risk_level,created_at")
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

  // Realtime: actualiza el badge de alertas sin recargar la página
  useEffect(() => {
    const channel = supabase
      .channel("dashboard-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, async () => {
        const { count } = await supabase.from("alerts").select("id", { count: "exact", head: true }).eq("read", false);
        setAlertsCount(count ?? 0);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const avg = Object.values(latest).filter(Boolean).reduce((a, s) => a + (s!.score), 0) / Math.max(1, Object.values(latest).filter(Boolean).length);

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">{t("dashboard.hello")}</h1>
            <p className="text-muted-foreground">{t("dashboard.summary")}</p>
          </div>
          <Link to="/children"><Button><Plus className="h-4 w-4 mr-2" /> {t("dashboard.addChild")}</Button></Link>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Card className="p-5 gradient-card shadow-soft">
            <div className="flex items-center gap-3 text-sm text-muted-foreground"><Brain className="h-4 w-4 text-primary" /> {t("dashboard.avgScore")}</div>
            <div className="text-4xl font-bold mt-2">{children.length ? Math.round(avg || 0) : "—"}</div>
          </Card>
          <Card className="p-5 gradient-card shadow-soft">
            <div className="flex items-center gap-3 text-sm text-muted-foreground"><AlertTriangle className="h-4 w-4 text-warning" /> {t("dashboard.activeAlerts")}</div>
            <div className="text-4xl font-bold mt-2">{alertsCount}</div>
          </Card>
          <Card className="p-5 gradient-card shadow-soft">
            <div className="flex items-center gap-3 text-sm text-muted-foreground"><TrendingUp className="h-4 w-4 text-secondary" /> {t("dashboard.monitoredChildren")}</div>
            <div className="text-4xl font-bold mt-2">{children.length}</div>
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
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {children.map(c => {
              const s = latest[c.id];
              const color = s ? riskColor(s.risk_level) : "muted";
              return (
                <Link key={c.id} to={`/child/${c.id}`}>
                  <Card className="p-5 hover:shadow-glow transition-smooth cursor-pointer h-full">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="text-3xl">{c.avatar_emoji}</div>
                        <div>
                          <div className="font-semibold">{c.name}</div>
                          <div className="text-xs text-muted-foreground">{t("dashboard.yearsOld", { age: c.age })}</div>
                        </div>
                      </div>
                      {s ? (
                        <div className={`text-${color} text-right`}>
                          <div className="text-3xl font-bold">{s.score}</div>
                          <div className="text-xs">{t(`risk.${s.risk_level}`)}</div>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">{t("dashboard.noData")}</div>
                      )}
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Dashboard;
