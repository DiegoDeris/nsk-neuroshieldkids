import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Brain, ShieldCheck, Sparkles, BarChart3, Bell, Trophy, Lock, Check, TrendingUp, Lightbulb, BookOpen, Smartphone, UserCheck, Activity } from "lucide-react";
import hero from "@/assets/nsk-hero.jpg";

const PRICES = {
  basic:   { monthly: "8.99€", annual: "6.58€", annualTotal: "79€" },
  premium: { monthly: "14.99€", annual: "9.92€", annualTotal: "119€" },
};

const Landing = () => {
  const { t } = useTranslation();
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");

  const plans = [
    { id: "free", name: t("plans.free.name"), price: "0€", period: t("plans.free.period"), annualNote: null,
      perks: [t("plans.free.p1"), t("plans.free.p2"), t("plans.free.p3")],
      cta: t("plans.free.cta"), highlight: false },
    { id: "basic", name: t("plans.basic.name"),
      price: billing === "monthly" ? PRICES.basic.monthly : PRICES.basic.annual,
      period: "/mes", annualNote: billing === "annual" ? `${PRICES.basic.annualTotal}/año · Ahorra ~2 meses` : null,
      perks: [t("plans.basic.p1"), t("plans.basic.p2"), t("plans.basic.p3"), t("plans.basic.p4")],
      cta: t("plans.basic.cta"), highlight: false },
    { id: "premium", name: t("plans.premium.name"),
      price: billing === "monthly" ? PRICES.premium.monthly : PRICES.premium.annual,
      period: "/mes", annualNote: billing === "annual" ? `${PRICES.premium.annualTotal}/año · Ahorra ~3 meses` : null,
      perks: [t("plans.premium.p1"), t("plans.premium.p2"), t("plans.premium.p3"), t("plans.premium.p4"), t("plans.premium.p6")],
      cta: t("plans.premium.cta"), highlight: true },
  ];

  const features = [
    { icon: Brain,       title: t("features.ai.title"),         text: t("features.ai.text") },
    { icon: Activity,    title: t("features.predictive.title"),  text: t("features.predictive.text") },
    { icon: Bell,        title: t("features.alerts.title"),      text: t("features.alerts.text") },
    { icon: BarChart3,   title: t("features.trends.title"),      text: t("features.trends.text") },
    { icon: Lightbulb,   title: t("features.recs.title"),        text: t("features.recs.text") },
    { icon: Trophy,      title: t("features.game.title"),        text: t("features.game.text") },
    { icon: BookOpen,    title: t("features.learn.title"),       text: t("features.learn.text") },
    { icon: Lock,        title: t("features.privacy.title"),     text: t("features.privacy.text") },
  ];

  return (
    <div className="min-h-screen">
      <header className="container flex items-center justify-between gap-2 py-5">
        <Logo />
        <nav className="flex items-center gap-1 sm:gap-2">
          <LanguageToggle compact />
          <Link to="/pricing" className="hidden sm:inline-flex"><Button variant="ghost">{t("landing.navPricing")}</Button></Link>
          <Link to="/auth"><Button variant="outline" size="sm" className="sm:h-10 sm:px-4">{t("landing.navLogin")}</Button></Link>
          <Link to="/auth?mode=signup"><Button size="sm" className="sm:h-10 sm:px-4">{t("landing.navStart")}</Button></Link>
        </nav>
      </header>

      <section className="container grid lg:grid-cols-2 gap-12 items-center py-12 lg:py-20">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/20 text-secondary-foreground text-sm font-medium">
            <Sparkles className="h-4 w-4" /> {t("landing.badge")}
          </div>
          <h1 className="text-5xl lg:text-6xl font-extrabold leading-tight">
            {t("landing.h1Pre")} <span className="text-gradient">{t("landing.h1Highlight")}</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl">{t("landing.subtitle")}</p>
          <div className="flex flex-wrap gap-3">
            <Link to="/auth?mode=signup"><Button size="lg" className="shadow-glow">{t("landing.ctaCreate")}</Button></Link>
            <a href="#como-funciona"><Button size="lg" variant="outline">{t("landing.ctaPlans")}</Button></a>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground pt-2">
            <div className="flex items-center gap-1"><ShieldCheck className="h-4 w-4 text-success" /> {t("landing.noSpyware")}</div>
            <div className="flex items-center gap-1"><Lock className="h-4 w-4 text-success" /> {t("landing.gdpr")}</div>
            <div className="flex items-center gap-1"><Brain className="h-4 w-4 text-primary" /> {t("landing.explainableAI")}</div>
          </div>
        </div>
        <div className="relative">
          <div className="absolute inset-0 gradient-hero rounded-3xl blur-3xl opacity-30 animate-pulse-glow" />
          <img src={hero} alt="NeuroShield Kids" width={1536} height={1024}
            className="relative rounded-3xl shadow-glow w-full h-auto animate-float" />
        </div>
      </section>

      {/* Cómo funciona */}
      <section id="como-funciona" className="container py-16">
        <h2 className="text-3xl lg:text-4xl font-bold text-center mb-12">{t("landing.howTitle")}</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            { icon: UserCheck, num: "1", title: t("landing.howStep1Title"), text: t("landing.howStep1Text") },
            { icon: Smartphone, num: "2", title: t("landing.howStep2Title"), text: t("landing.howStep2Text"), badges: true },
            { icon: TrendingUp, num: "3", title: t("landing.howStep3Title"), text: t("landing.howStep3Text") },
          ].map(s => (
            <div key={s.num} className="flex flex-col items-center text-center gap-4">
              <div className="relative">
                <div className="h-16 w-16 rounded-2xl gradient-primary flex items-center justify-center shadow-glow">
                  <s.icon className="h-8 w-8 text-primary-foreground" />
                </div>
                <span className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-secondary text-secondary-foreground text-xs font-bold flex items-center justify-center">{s.num}</span>
              </div>
              <h3 className="text-lg font-semibold">{s.title}</h3>
              <p className="text-sm text-muted-foreground">{s.text}</p>
              {s.badges && (
                <div className="flex gap-2 justify-center flex-wrap">
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-success/20 text-success border border-success/30">{t("landing.androidBadge")}</span>
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border">{t("landing.iosBadge")}</span>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-10 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-success shrink-0" />
            {t("landing.privacyPillars")}
          </div>
        </div>
      </section>

      <section className="container py-16">
        <h2 className="text-3xl lg:text-4xl font-bold text-center mb-12">{t("landing.featuresTitle")}</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {features.map(f => (
            <div key={f.title} className="gradient-card border border-border rounded-2xl p-6 shadow-soft hover:shadow-glow transition-smooth">
              <div className="h-12 w-12 rounded-xl gradient-primary flex items-center justify-center mb-4">
                <f.icon className="h-6 w-6 text-primary-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
              <p className="text-muted-foreground text-sm">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="planes" className="container py-16">
        <div className="text-center max-w-2xl mx-auto mb-8">
          <h2 className="text-3xl lg:text-4xl font-bold mb-3">{t("landing.plansTitle")}</h2>
          <p className="text-muted-foreground mb-6">{t("landing.plansSubtitle")}</p>
          <div className="inline-flex items-center bg-muted rounded-full p-1 gap-1">
            <button onClick={() => setBilling("monthly")} className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${billing === "monthly" ? "bg-background shadow text-foreground" : "text-muted-foreground"}`}>
              {t("plans.monthly")}
            </button>
            <button onClick={() => setBilling("annual")} className={`px-5 py-2 rounded-full text-sm font-semibold transition-all flex items-center gap-2 ${billing === "annual" ? "bg-background shadow text-foreground" : "text-muted-foreground"}`}>
              {t("plans.annual")} <span className="text-xs bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full">−30%</span>
            </button>
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {plans.map(p => (
            <div key={p.id} className={`relative rounded-2xl p-6 border bg-card shadow-soft transition-smooth hover:shadow-glow ${p.highlight ? "border-primary shadow-glow" : "border-border"}`}>
              {p.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="px-3 py-1 rounded-full text-xs font-semibold gradient-hero text-primary-foreground">{t("landing.popular")}</span>
                </div>
              )}
              <h3 className="text-xl font-bold">{p.name}</h3>
              <div className="mt-3 mb-1">
                <span className="text-4xl font-extrabold">{p.price}</span>
                <span className="text-muted-foreground text-sm">{p.period}</span>
              </div>
              {p.annualNote && <p className="text-xs text-emerald-600 font-semibold mb-3">{p.annualNote}</p>}
              {!p.annualNote && <div className="mb-4" />}
              <ul className="space-y-2 mb-6">
                {p.perks.map(perk => (
                  <li key={perk} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-success mt-0.5 shrink-0" />
                    <span>{perk}</span>
                  </li>
                ))}
              </ul>
              <Link to="/auth?mode=signup" className="block">
                <Button className={`w-full ${p.highlight ? "shadow-glow" : ""}`} variant={p.highlight ? "default" : "outline"}>{p.cta}</Button>
              </Link>
            </div>
          ))}
        </div>
        <div className="gradient-hero rounded-3xl p-10 lg:p-16 text-center text-primary-foreground shadow-glow">
          <h2 className="text-4xl font-bold mb-4">{t("landing.ctaFinalTitle")}</h2>
          <p className="opacity-90 mb-8 max-w-2xl mx-auto">{t("landing.ctaFinalText")}</p>
          <Link to="/auth?mode=signup"><Button size="lg" variant="secondary" className="shadow-lime">{t("landing.ctaCreate")}</Button></Link>
        </div>
      </section>

      <footer className="container py-10 text-center text-sm text-muted-foreground space-y-1">
        <p>{t("landing.footer", { year: new Date().getFullYear() })}</p>
        <p>
          <Link to="/privacy" className="hover:underline">Política de privacidad</Link>
          {" · "}
          <a href="mailto:privacidad@nsk.app" className="hover:underline">privacidad@nsk.app</a>
        </p>
      </footer>
    </div>
  );
};

export default Landing;
