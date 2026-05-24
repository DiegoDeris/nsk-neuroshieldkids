import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BellOff, Heart, Phone, MessageCircle, ExternalLink, AlertTriangle, Lightbulb, ChevronDown, ChevronUp } from "lucide-react";

type Sev = "preventive" | "moderate" | "critical";

function fixMojibake(s: string | null | undefined): string {
  if (!s) return s ?? "";
  if ([...s].some(c => c.charCodeAt(0) > 255)) return s;
  try {
    const bytes = new Uint8Array([...s].map(c => c.charCodeAt(0)));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { return s; }
}

const Alerts = () => {
  const { t, i18n } = useTranslation();
  const [list, setList] = useState<any[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase.from("alerts")
      .select("*, children(name, avatar_emoji)")
      .order("created_at", { ascending: false });
    setList(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const markRead = async (id: string) => {
    await supabase.from("alerts").update({ read: true }).eq("id", id);
    load();
  };

  const sevColor: Record<Sev, any> = { critical: "destructive", moderate: "default", preventive: "secondary" };
  const locale = i18n.resolvedLanguage?.startsWith("en") ? "en" : "es";
  const isEs = locale === "es";

  const criticalCount = list.filter(a => a.severity === "critical" && !a.read).length;

  // Professional resources by locale
  const proResources = isEs ? [
    { name: "ANAR (Niños y Adolescentes)", phone: "900 20 20 10", desc: "Línea gratuita 24h para menores en situación de riesgo.", url: "https://www.anar.org" },
    { name: "Teléfono de la Esperanza", phone: "717 003 717", desc: "Apoyo emocional y crisis 24h, también para familias.", url: "https://telefonodelaesperanza.org" },
    { name: "INCIBE - Ciberacoso (Línea de Ayuda)", phone: "017", desc: "Ayuda gratuita en ciberseguridad y acoso digital.", url: "https://www.incibe.es/linea-de-ayuda" },
    { name: "024 - Atención a la Conducta Suicida", phone: "024", desc: "Línea 24h del Ministerio de Sanidad.", url: "https://www.sanidad.gob.es" },
  ] : [
    { name: "Crisis Text Line", phone: "Text HOME to 741741", desc: "Free 24/7 crisis support via text.", url: "https://www.crisistextline.org" },
    { name: "988 Suicide & Crisis Lifeline", phone: "988", desc: "Free, confidential 24/7 support (US).", url: "https://988lifeline.org" },
    { name: "SAMHSA National Helpline", phone: "1-800-662-4357", desc: "24/7 mental health & substance use referrals.", url: "https://www.samhsa.gov/find-help" },
    { name: "StopBullying.gov", phone: "—", desc: "Cyberbullying resources for parents.", url: "https://www.stopbullying.gov" },
  ];

  const adviceFor = (a: any): { advice: string[]; talk: string } => {
    const sev: Sev = a.severity;
    const text = `${a.title} ${a.message}`.toLowerCase();
    const tips: string[] = [];

    if (text.includes("noct") || text.includes("night") || text.includes("sleep")) {
      tips.push(t("alerts.adv.night1"));
      tips.push(t("alerts.adv.night2"));
    }
    if (text.includes("tiktok") || text.includes("instagram") || text.includes("scroll") || text.includes("redes") || text.includes("social")) {
      tips.push(t("alerts.adv.social1"));
      tips.push(t("alerts.adv.social2"));
    }
    if (text.includes("burst") || text.includes("compuls") || text.includes("apertur")) {
      tips.push(t("alerts.adv.burst1"));
    }
    if (text.includes("forbidden") || text.includes("prohib")) {
      tips.push(t("alerts.adv.forbidden1"));
    }
    if (tips.length === 0) {
      tips.push(t("alerts.adv.generic1"));
      tips.push(t("alerts.adv.generic2"));
      tips.push(t("alerts.adv.generic3"));
    }
    const talk = sev === "critical" ? t("alerts.talk.critical") : sev === "moderate" ? t("alerts.talk.moderate") : t("alerts.talk.preventive");
    return { advice: tips.slice(0, 4), talk };
  };

  return (
    <AppLayout>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-6">
        <div>
          <h1 className="text-3xl font-bold">{t("alerts.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("alerts.subtitle")}</p>
        </div>
        {criticalCount > 0 && (
          <Badge variant="destructive" className="gap-1 text-sm py-1.5 px-3">
            <AlertTriangle className="h-3.5 w-3.5" /> {t("alerts.criticalCount", { n: criticalCount })}
          </Badge>
        )}
      </div>

      {criticalCount > 0 && (
        <Alert variant="destructive" className="mb-5">
          <Heart className="h-4 w-4" />
          <AlertTitle>{t("alerts.proTitle")}</AlertTitle>
          <AlertDescription>
            <p className="mb-3">{t("alerts.proDesc")}</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {proResources.map(r => (
                <a key={r.name} href={r.url} target="_blank" rel="noreferrer"
                   className="block p-3 rounded-lg border bg-background hover:border-primary transition-smooth">
                  <div className="font-semibold text-foreground text-sm flex items-center gap-1">
                    <Phone className="h-3 w-3" /> {r.name}
                  </div>
                  <div className="text-base font-bold text-foreground mt-0.5">{r.phone}</div>
                  <div className="text-xs text-muted-foreground mt-1">{r.desc}</div>
                  <div className="text-xs text-primary mt-1 flex items-center gap-1">
                    {t("alerts.visit")} <ExternalLink className="h-3 w-3" />
                  </div>
                </a>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        {list.length === 0 && (
          <Card className="p-10 text-center text-muted-foreground">{t("alerts.empty")}</Card>
        )}
        {list.map(a => {
          const { advice, talk } = adviceFor(a);
          const open = openId === a.id;
          const isCritical = a.severity === "critical";
          return (
            <Card key={a.id} className={`p-4 ${a.read ? "opacity-60" : ""} ${isCritical && !a.read ? "border-destructive/40" : ""}`}>
              <div className="flex items-start gap-4">
                <div className="text-2xl">{a.children?.avatar_emoji ?? "🧒"}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge variant={sevColor[a.severity as Sev]} className="capitalize">{t(`rules.sev.${a.severity}`)}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString(locale)}</span>
                    {a.children?.name && <span className="text-xs text-muted-foreground">· {a.children.name}</span>}
                  </div>
                  <div className="font-semibold">{fixMojibake(a.title)}</div>
                  <p className="text-sm text-muted-foreground mt-1">{fixMojibake(a.message)}</p>

                  <Button variant="ghost" size="sm" className="mt-2 -ml-2 h-7"
                    onClick={() => setOpenId(open ? null : a.id)}>
                    <Lightbulb className="h-3 w-3 mr-1" /> {open ? t("alerts.hideAdvice") : t("alerts.showAdvice")}
                    {open ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
                  </Button>

                  {open && (
                    <div className="mt-3 p-3 rounded-lg bg-muted/40 space-y-3">
                      <div>
                        <div className="text-xs font-semibold mb-1.5 flex items-center gap-1">
                          <Lightbulb className="h-3 w-3 text-primary" /> {t("alerts.actionable")}
                        </div>
                        <ul className="text-sm space-y-1">
                          {advice.map((tip, i) => <li key={i}>✓ {tip}</li>)}
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-semibold mb-1 flex items-center gap-1">
                          <MessageCircle className="h-3 w-3 text-primary" /> {t("alerts.howToTalk")}
                        </div>
                        <p className="text-sm italic text-muted-foreground">"{talk}"</p>
                      </div>
                      {isCritical && (
                        <div className="pt-2 border-t">
                          <div className="text-xs font-semibold mb-1 flex items-center gap-1 text-destructive">
                            <Heart className="h-3 w-3" /> {t("alerts.needHelp")}
                          </div>
                          <p className="text-xs text-muted-foreground">{t("alerts.needHelpDesc")}</p>
                          <a href={proResources[0].url} target="_blank" rel="noreferrer">
                            <Button size="sm" variant="destructive" className="mt-2">
                              <Phone className="h-3 w-3 mr-1" /> {proResources[0].phone}
                            </Button>
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {!a.read && (
                  <Button size="sm" variant="ghost" onClick={() => markRead(a.id)} title={t("alerts.markRead")}>
                    <BellOff className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </AppLayout>
  );
};

export default Alerts;
