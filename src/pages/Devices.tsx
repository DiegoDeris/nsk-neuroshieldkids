import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Smartphone, Send, Wifi, WifiOff, Activity, Brain, TrendingUp, TrendingDown, Minus, Sparkles, Clock, Moon, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { QuickConnect } from "@/components/QuickConnect";
import { toast } from "sonner";

function fixMojibake(s: string | null | undefined): string {
  if (!s) return s ?? "";
  if ([...s].some(c => c.charCodeAt(0) > 255)) return s;
  try {
    const bytes = new Uint8Array([...s].map(c => c.charCodeAt(0)));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { return s; }
}

const PROJECT_URL = import.meta.env.VITE_SUPABASE_URL;
const INGEST_URL = `${PROJECT_URL}/functions/v1/ingest-usage`;

const Devices = () => {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const [list, setList] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [todayMetric, setTodayMetric] = useState<any>(null);
  const [liveEvents, setLiveEvents] = useState<any[]>([]);
  const [lastPred, setLastPred] = useState<any>(null);
  const [predicting, setPredicting] = useState(false);
  const [, tick] = useState(0);

  const load = async () => {
    const { data } = await supabase.from("children").select("*").order("created_at");
    setList(data ?? []);
    if (data && data.length && !selected) setSelected(data[0].id);
    setLoading(false);
  };

  const loadDetail = async (childId: string) => {
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: m }, { data: ev }, { data: p }] = await Promise.all([
      supabase.from("usage_metrics").select("*").eq("child_id", childId).eq("metric_date", today).maybeSingle(),
      supabase.from("usage_events").select("*").eq("child_id", childId).order("occurred_at", { ascending: false }).limit(15),
      supabase.from("predictions").select("*").eq("child_id", childId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setTodayMetric(m);
    setLiveEvents(ev ?? []);
    setLastPred(p);
  };

  useEffect(() => { if (user) load(); }, [user]);
  useEffect(() => { if (selected) loadDetail(selected); }, [selected]);

  // Refresh "hace X" labels every 15s
  useEffect(() => {
    const i = setInterval(() => tick(x => x + 1), 15000);
    return () => clearInterval(i);
  }, []);

  // Live updates
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel("rt-devices")
      .on("postgres_changes", { event: "*", schema: "public", table: "children", filter: `parent_id=eq.${user.id}` }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "usage_events", filter: `parent_id=eq.${user.id}` }, (payload) => {
        if (selected && payload.new.child_id === selected) {
          setLiveEvents(prev => [payload.new as any, ...prev].slice(0, 15));
          loadDetail(selected);
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "predictions", filter: `parent_id=eq.${user.id}` }, (payload) => {
        if (selected && payload.new.child_id === selected) setLastPred(payload.new);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, selected]);

  const sendTest = async (child: any) => {
    if (!child.ingest_token) return toast.error("Token no disponible");
    try {
      const res = await fetch(INGEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: child.ingest_token,
          events: [{ app_name: "TestApp", duration_seconds: 60, event_type: "app_usage" }],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "error");
      toast.success(t("devices.testOk"));
      load();
    } catch (e: any) { toast.error(`❌ ${e.message}`); }
  };

  const runPrediction = async () => {
    if (!selected) return;
    setPredicting(true);
    try {
      const { data, error } = await supabase.functions.invoke("predict-trends", { body: { child_id: selected } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(t("devices.predictOk"));
    } catch (e: any) { toast.error(e.message); }
    finally { setPredicting(false); }
  };

  const isOnline = (c: any) => c.last_ingest_at && Date.now() - new Date(c.last_ingest_at).getTime() < 5 * 60 * 1000;
  const isRecent = (c: any) => c.last_ingest_at && Date.now() - new Date(c.last_ingest_at).getTime() < 24 * 60 * 60 * 1000;

  const current = list.find(c => c.id === selected);

  const ago = (iso: string) => {
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86400) return `${Math.round(s / 3600)}h`;
    return `${Math.round(s / 86400)}d`;
  };

  const TrendIcon = lastPred?.trend === "improving" ? TrendingDown : lastPred?.trend === "worsening" ? TrendingUp : Minus;
  const trendColor = lastPred?.trend === "improving" ? "text-green-600" : lastPred?.trend === "worsening" ? "text-red-600" : "text-muted-foreground";

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Smartphone className="h-7 w-7 text-primary" /> {t("devices.title")}
          </h1>
          <p className="text-muted-foreground">{t("devices.subtitle")}</p>
        </div>

        {loading ? (
          <Card className="p-10 text-center text-muted-foreground">{t("common.loading")}</Card>
        ) : list.length === 0 ? (
          <Card className="p-10 text-center border-dashed">
            <p className="text-muted-foreground mb-4">{t("devices.noChildren")}</p>
            <Link to="/children"><Button>{t("devices.addChildCta")}</Button></Link>
          </Card>
        ) : (
          <>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {list.map(c => {
                const live = isOnline(c); const recent = isRecent(c);
                const active = c.id === selected;
                return (
                  <Card key={c.id} onClick={() => setSelected(c.id)}
                    className={`p-4 cursor-pointer transition-smooth hover:shadow-soft ${active ? "border-primary ring-2 ring-primary/20" : ""}`}>
                    <div className="flex items-center gap-3">
                      <div className="text-3xl">{c.avatar_emoji}</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate flex items-center gap-2">
                          {c.name}
                          {live && <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {c.last_ingest_at ? `${t("devices.lastSync")} ${ago(c.last_ingest_at)}` : t("devices.neverSynced")}
                        </div>
                      </div>
                      <Badge variant={live ? "default" : recent ? "secondary" : "outline"} className="gap-1 shrink-0">
                        {live ? <><Wifi className="h-3 w-3" /> {t("devices.live")}</> :
                         recent ? <><Wifi className="h-3 w-3" /> {t("devices.online")}</> :
                         <><WifiOff className="h-3 w-3" /> {t("devices.offline")}</>}
                      </Badge>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={(e) => { e.stopPropagation(); sendTest(c); }}>
                        <Send className="h-3 w-3 mr-1" /> {t("devices.test")}
                      </Button>
                      <Link to={`/child/${c.id}`} onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="ghost"><Brain className="h-3 w-3" /></Button>
                      </Link>
                    </div>
                  </Card>
                );
              })}
            </div>

            {current && (
              <>
                {/* Today metrics */}
                <div className="grid md:grid-cols-4 gap-3">
                  <Card className="p-4">
                    <div className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> {t("devices.todayTime")}</div>
                    <div className="text-2xl font-bold mt-1">{todayMetric?.total_minutes ?? 0}<span className="text-sm font-normal text-muted-foreground"> min</span></div>
                  </Card>
                  <Card className="p-4">
                    <div className="text-xs text-muted-foreground flex items-center gap-1"><Moon className="h-3 w-3" /> {t("devices.night")}</div>
                    <div className="text-2xl font-bold mt-1">{todayMetric?.night_minutes ?? 0}<span className="text-sm font-normal text-muted-foreground"> min</span></div>
                  </Card>
                  <Card className="p-4">
                    <div className="text-xs text-muted-foreground flex items-center gap-1"><Zap className="h-3 w-3" /> {t("devices.sessions")}</div>
                    <div className="text-2xl font-bold mt-1">{todayMetric?.sessions ?? 0}</div>
                  </Card>
                  <Card className="p-4">
                    <div className="text-xs text-muted-foreground">{t("devices.dominant")}</div>
                    <div className="text-lg font-semibold mt-1 truncate">{todayMetric?.dominant_app ?? "—"}</div>
                  </Card>
                </div>

                {/* Prediction + Live feed */}
                <div className="grid md:grid-cols-2 gap-4">
                  <Card className="p-5 gradient-card">
                    <div className="flex items-center justify-between mb-3">
                      <div className="font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> {t("devices.forecast")}</div>
                      <Button size="sm" onClick={runPrediction} disabled={predicting}>
                        {predicting ? t("devices.predicting") : t("devices.predict")}
                      </Button>
                    </div>
                    {lastPred ? (
                      <div className="space-y-3">
                        <div className="flex items-baseline gap-3">
                          <div className="text-4xl font-extrabold text-gradient">{lastPred.predicted_score}</div>
                          <Badge variant={lastPred.predicted_risk === "high" ? "destructive" : lastPred.predicted_risk === "medium" ? "secondary" : "default"}>
                            {t(`risk.${lastPred.predicted_risk}`)}
                          </Badge>
                          <span className={`flex items-center gap-1 text-sm ${trendColor}`}>
                            <TrendIcon className="h-4 w-4" /> {t(`devices.trend.${lastPred.trend}`)}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">{fixMojibake(lastPred.explanation)}</p>
                        {lastPred.drivers?.length > 0 && (
                          <div>
                            <div className="text-xs font-medium mb-1">{t("devices.drivers")}</div>
                            <ul className="text-sm space-y-1">
                              {lastPred.drivers.map((d: string, i: number) => <li key={i}>• {fixMojibake(d)}</li>)}
                            </ul>
                          </div>
                        )}
                        {lastPred.prevention_plan?.length > 0 && (
                          <div>
                            <div className="text-xs font-medium mb-1">{t("devices.plan")}</div>
                            <ul className="text-sm space-y-1">
                              {lastPred.prevention_plan.map((d: string, i: number) => <li key={i}>✓ {d}</li>)}
                            </ul>
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground">{t("devices.confidence")}: {lastPred.confidence}%</div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t("devices.noForecast")}</p>
                    )}
                  </Card>

                  <Card className="p-5">
                    <div className="font-semibold flex items-center gap-2 mb-3">
                      <Activity className="h-4 w-4 text-primary" />
                      {t("devices.liveFeed")}
                      {isOnline(current) && <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />}
                    </div>
                    {liveEvents.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("devices.noEvents")}</p>
                    ) : (
                      <ul className="space-y-2 max-h-80 overflow-y-auto">
                        {liveEvents.map(e => (
                          <li key={e.id} className="flex items-start justify-between gap-2 text-sm border-b pb-2 last:border-0">
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{e.app_name ?? e.event_type}</div>
                              <div className="text-xs text-muted-foreground">
                                {e.duration_seconds > 0 ? `${Math.round(e.duration_seconds / 60)} min · ` : ""}
                                {new Date(e.occurred_at).toLocaleTimeString(i18n.language)}
                              </div>
                            </div>
                            <Badge variant="outline" className="text-xs shrink-0">{ago(e.occurred_at)}</Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </div>

                <QuickConnect child={current} onChange={() => { load(); loadDetail(current.id); }} />
              </>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default Devices;
