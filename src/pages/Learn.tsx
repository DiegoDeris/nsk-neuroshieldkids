import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpen, MessageCircle, Moon, ShieldAlert, Heart, Brain, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";

type Lesson = {
  key: string;
  icon: any;
  category: "communication" | "sleep" | "risks" | "wellbeing" | "emotion";
  ageMin: number; ageMax: number; minutes: number;
};

const LESSONS: Lesson[] = [
  { key: "talk", icon: MessageCircle, category: "communication", ageMin: 6, ageMax: 18, minutes: 4 },
  { key: "warning", icon: ShieldAlert, category: "risks", ageMin: 9, ageMax: 18, minutes: 5 },
  { key: "night", icon: Moon, category: "sleep", ageMin: 6, ageMax: 18, minutes: 3 },
  { key: "habits", icon: Heart, category: "wellbeing", ageMin: 6, ageMax: 18, minutes: 4 },
  { key: "dopamine", icon: Brain, category: "emotion", ageMin: 10, ageMax: 18, minutes: 6 },
  { key: "cyber", icon: ShieldAlert, category: "risks", ageMin: 8, ageMax: 18, minutes: 5 },
  { key: "selfimage", icon: Heart, category: "emotion", ageMin: 11, ageMax: 18, minutes: 5 },
  { key: "boundaries", icon: ShieldAlert, category: "communication", ageMin: 6, ageMax: 18, minutes: 4 },
];

const CATEGORIES = ["all", "communication", "sleep", "risks", "wellbeing", "emotion"] as const;

const Learn = () => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<typeof CATEGORIES[number]>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("nsk_lessons_done") ?? "[]")); } catch { return new Set(); }
  });

  const toggleDone = (key: string) => {
    const next = new Set(done);
    next.has(key) ? next.delete(key) : next.add(key);
    setDone(next);
    localStorage.setItem("nsk_lessons_done", JSON.stringify([...next]));
  };

  const filtered = filter === "all" ? LESSONS : LESSONS.filter(l => l.category === filter);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><BookOpen className="h-7 w-7 text-primary" /> {t("learn.title")}</h1>
          <p className="text-muted-foreground">{t("learn.subtitle")}</p>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map(c => (
              <Button key={c} size="sm" variant={filter === c ? "default" : "outline"} onClick={() => setFilter(c)}>
                {t(`learn.cat.${c}`)}
              </Button>
            ))}
          </div>
          <Badge variant="secondary">{done.size}/{LESSONS.length} {t("learn.completed")}</Badge>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {filtered.map(l => {
            const isOpen = open === l.key;
            const isDone = done.has(l.key);
            const Icon = l.icon;
            const steps = (t(`learn.lessons.${l.key}.steps`, { returnObjects: true }) as string[]) ?? [];
            return (
              <Card key={l.key} className={`p-5 transition-smooth ${isDone ? "border-green-500/40" : ""}`}>
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{t(`learn.lessons.${l.key}.title`)}</h3>
                      {isDone && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                    </div>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      <Badge variant="outline" className="text-xs">{t(`learn.cat.${l.category}`)}</Badge>
                      <Badge variant="outline" className="text-xs">{l.ageMin}-{l.ageMax} {t("learn.years")}</Badge>
                      <Badge variant="outline" className="text-xs">{l.minutes} min</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">{t(`learn.lessons.${l.key}.body`)}</p>
                    {isOpen && (
                      <div className="mt-3 space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("learn.actionSteps")}</div>
                        <ol className="space-y-1.5 text-sm">
                          {steps.map((s, i) => (
                            <li key={i} className="flex gap-2"><span className="text-primary font-bold">{i + 1}.</span> {s}</li>
                          ))}
                        </ol>
                        <div className="p-3 bg-muted rounded-lg text-sm mt-2">
                          <span className="font-semibold">💡 {t("learn.tip")}: </span>
                          {t(`learn.lessons.${l.key}.tip`)}
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" variant="ghost" onClick={() => setOpen(isOpen ? null : l.key)}>
                        {isOpen ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                        {isOpen ? t("learn.collapse") : t("learn.expand")}
                      </Button>
                      <Button size="sm" variant={isDone ? "secondary" : "outline"} onClick={() => toggleDone(l.key)}>
                        <CheckCircle2 className="h-3 w-3 mr-1" /> {isDone ? t("learn.markUndone") : t("learn.markDone")}
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
};

export default Learn;
