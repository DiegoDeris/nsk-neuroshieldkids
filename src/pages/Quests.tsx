import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Trophy, Flame, Plus, Check, Sparkles, Target, Star } from "lucide-react";
import { toast } from "sonner";

const PRESETS = [
  { key: "screen_break", points: 20, days: 3, category: "habit" },
  { key: "no_phone_dinner", points: 25, days: 5, category: "family" },
  { key: "sleep_no_phone", points: 30, days: 7, category: "sleep" },
  { key: "outdoor", points: 20, days: 3, category: "wellbeing" },
  { key: "homework_first", points: 15, days: 5, category: "habit" },
  { key: "social_pause", points: 25, days: 3, category: "wellbeing" },
];

const Quests = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [children, setChildren] = useState<any[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [quests, setQuests] = useState<any[]>([]);
  const [game, setGame] = useState<any>(null);
  const [custom, setCustom] = useState("");

  const load = async () => {
    const { data: c } = await supabase.from("children").select("*").order("created_at");
    setChildren(c ?? []);
    if (c && c.length && !selected) setSelected(c[0].id);
  };

  const loadQuests = async (cid: string) => {
    const [{ data: q }, { data: g }] = await Promise.all([
      supabase.from("quests").select("*").eq("child_id", cid).order("created_at", { ascending: false }),
      supabase.from("gamification").select("*").eq("child_id", cid).maybeSingle(),
    ]);
    setQuests(q ?? []); setGame(g);
  };

  useEffect(() => { if (user) load(); }, [user]);
  useEffect(() => { if (selected) loadQuests(selected); }, [selected]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel("rt-quests")
      .on("postgres_changes", { event: "*", schema: "public", table: "quests", filter: `parent_id=eq.${user.id}` }, () => selected && loadQuests(selected))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, selected]);

  const addPreset = async (preset: typeof PRESETS[0]) => {
    if (!selected || !user) return;
    const { error } = await supabase.from("quests").insert([{
      parent_id: user.id, child_id: selected,
      title: t(`quests.presets.${preset.key}.title`),
      description: t(`quests.presets.${preset.key}.desc`),
      category: preset.category, points: preset.points, target_days: preset.days,
    }]);
    if (error) return toast.error(error.message);
    toast.success(t("quests.added"));
  };

  const addCustom = async () => {
    if (!custom.trim() || !selected || !user) return;
    await supabase.from("quests").insert([{
      parent_id: user.id, child_id: selected, title: custom.trim(), category: "custom", points: 15, target_days: 3,
    }]);
    setCustom("");
  };

  const incrementProgress = async (q: any) => {
    const newProgress = Math.min(q.target_days, q.progress + 1);
    const completed = newProgress >= q.target_days;
    await supabase.from("quests").update({
      progress: newProgress,
      status: completed ? "completed" : q.status,
      completed_at: completed ? new Date().toISOString() : null,
    }).eq("id", q.id);
    if (completed && game) {
      const newPoints = (game.points ?? 0) + q.points;
      const newLevel = Math.floor(newPoints / 100) + 1;
      const badges = (game.badges ?? []) as string[];
      if (q.category === "sleep" && !badges.includes("🌙 Buen dormir")) badges.push("🌙 Buen dormir");
      if (q.category === "family" && !badges.includes("👨‍👩‍👧 Familia presente")) badges.push("👨‍👩‍👧 Familia presente");
      if (newPoints >= 500 && !badges.includes("🏆 Leyenda digital")) badges.push("🏆 Leyenda digital");
      await supabase.from("gamification").upsert([{
        parent_id: user!.id, child_id: selected, points: newPoints, badges, level: newLevel,
      }], { onConflict: "child_id" });
      toast.success(`🎉 +${q.points} pts`);
    }
  };

  const removeQuest = async (id: string) => {
    await supabase.from("quests").delete().eq("id", id);
  };

  const active = quests.filter(q => q.status === "active");
  const done = quests.filter(q => q.status === "completed");

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Trophy className="h-7 w-7 text-primary" /> {t("quests.title")}
            </h1>
            <p className="text-muted-foreground">{t("quests.subtitle")}</p>
          </div>
          {children.length > 0 && (
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {children.map(c => <SelectItem key={c.id} value={c.id}>{c.avatar_emoji} {c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>

        {children.length === 0 ? (
          <Card className="p-10 text-center border-dashed">{t("devices.noChildren")}</Card>
        ) : (
          <>
            {/* Stats */}
            <div className="grid md:grid-cols-4 gap-3">
              <Card className="p-4 gradient-card">
                <div className="text-xs text-muted-foreground flex items-center gap-1"><Star className="h-3 w-3" /> {t("quests.points")}</div>
                <div className="text-3xl font-bold text-gradient">{game?.points ?? 0}</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-muted-foreground flex items-center gap-1"><Trophy className="h-3 w-3" /> {t("quests.level")}</div>
                <div className="text-3xl font-bold">{game?.level ?? 1}</div>
                <Progress value={((game?.points ?? 0) % 100)} className="mt-2 h-1.5" />
              </Card>
              <Card className="p-4">
                <div className="text-xs text-muted-foreground flex items-center gap-1"><Flame className="h-3 w-3 text-orange-500" /> {t("quests.streak")}</div>
                <div className="text-3xl font-bold">{game?.streak_days ?? 0}<span className="text-sm font-normal text-muted-foreground"> {t("quests.days")}</span></div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-muted-foreground">{t("quests.badges")}</div>
                <div className="flex flex-wrap gap-1 mt-2 min-h-[28px]">
                  {(game?.badges ?? []).length === 0 ? <span className="text-xs text-muted-foreground">{t("quests.noBadges")}</span> :
                    (game?.badges ?? []).map((b: string) => <Badge key={b} variant="secondary">{b}</Badge>)}
                </div>
              </Card>
            </div>

            {/* Add quests */}
            <Card className="p-5">
              <h2 className="font-semibold mb-3 flex items-center gap-2"><Plus className="h-4 w-4" /> {t("quests.addPreset")}</h2>
              <div className="grid md:grid-cols-3 gap-2">
                {PRESETS.map(p => (
                  <button key={p.key} onClick={() => addPreset(p)}
                    className="text-left p-3 rounded-lg border hover:border-primary hover:bg-muted transition-smooth">
                    <div className="font-medium text-sm">{t(`quests.presets.${p.key}.title`)}</div>
                    <div className="text-xs text-muted-foreground mt-1">{t(`quests.presets.${p.key}.desc`)}</div>
                    <div className="flex gap-2 mt-2">
                      <Badge variant="outline" className="text-xs">+{p.points} pts</Badge>
                      <Badge variant="outline" className="text-xs">{p.days} {t("quests.days")}</Badge>
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex gap-2 mt-4">
                <Input value={custom} onChange={e => setCustom(e.target.value)} placeholder={t("quests.customPh")} maxLength={120} />
                <Button onClick={addCustom} disabled={!custom.trim()}><Plus className="h-4 w-4 mr-1" /> {t("common.create")}</Button>
              </div>
            </Card>

            {/* Active */}
            <div>
              <h2 className="font-semibold mb-3 flex items-center gap-2"><Target className="h-4 w-4 text-primary" /> {t("quests.active")} ({active.length})</h2>
              {active.length === 0 ? (
                <Card className="p-6 text-center text-muted-foreground border-dashed">{t("quests.empty")}</Card>
              ) : (
                <div className="grid md:grid-cols-2 gap-3">
                  {active.map(q => (
                    <Card key={q.id} className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold">{q.title}</div>
                          {q.description && <p className="text-xs text-muted-foreground mt-1">{q.description}</p>}
                        </div>
                        <Badge variant="secondary" className="shrink-0">+{q.points}</Badge>
                      </div>
                      <Progress value={(q.progress / q.target_days) * 100} className="mt-3 h-2" />
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-muted-foreground">{q.progress}/{q.target_days} {t("quests.days")}</span>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => removeQuest(q.id)}>{t("common.delete")}</Button>
                          <Button size="sm" onClick={() => incrementProgress(q)}>
                            <Check className="h-3 w-3 mr-1" /> {t("quests.markDay")}
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {done.length > 0 && (
              <div>
                <h2 className="font-semibold mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> {t("quests.completed")} ({done.length})</h2>
                <div className="grid md:grid-cols-3 gap-2">
                  {done.slice(0, 6).map(q => (
                    <Card key={q.id} className="p-3 opacity-70">
                      <div className="text-sm font-medium line-through">{q.title}</div>
                      <Badge variant="outline" className="mt-1 text-xs">+{q.points} pts</Badge>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default Quests;
