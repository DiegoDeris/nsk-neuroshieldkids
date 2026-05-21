import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Brain, ShieldCheck, Sparkles, BarChart3, Bell, Trophy, FileText, Lock, Check } from "lucide-react";
import hero from "@/assets/nsk-hero.jpg";

const Landing = () => {
  const { t } = useTranslation();

  const plans = [
    { id: "free", name: t("plans.free.name"), price: "0€", period: t("plans.free.period"),
      perks: [t("plans.free.p1"), t("plans.free.p2"), t("plans.free.p3")],
      cta: t("plans.free.cta"), highlight: false },
    { id: "basic", name: t("plans.basic.name"), price: "12€", period: t("plans.basic.period"),
      perks: [t("plans.basic.p1"), t("plans.basic.p2"), t("plans.basic.p3"), t("plans.basic.p4")],
      cta: t("plans.basic.cta"), highlight: false },
    { id: "premium", name: t("plans.premium.name"), price: "29€", period: t("plans.premium.period"),
      perks: [t("plans.premium.p1"), t("plans.premium.p2"), t("plans.premium.p3"), t("plans.premium.p4"), t("plans.premium.p6")],
      cta: t("plans.premium.cta"), highlight: true },
  ];

  const features = [
    { icon: Brain, title: t("features.ai.title"), text: t("features.ai.text") },
    { icon: Bell, title: t("features.alerts.title"), text: t("features.alerts.text") },
    { icon: BarChart3, title: t("features.trends.title"), text: t("features.trends.text") },
    { icon: Trophy, title: t("features.game.title"), text: t("features.game.text") },
    { icon: FileText, title: t("features.pdf.title"), text: t("features.pdf.text") },
    { icon: Lock, title: t("features.privacy.title"), text: t("features.privacy.text") },
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
            <Link to="/pricing"><Button size="lg" variant="outline">{t("landing.ctaPlans")}</Button></Link>
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

      <section className="container py-16">
        <h2 className="text-3xl lg:text-4xl font-bold text-center mb-12">{t("landing.featuresTitle")}</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
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
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h2 className="text-3xl lg:text-4xl font-bold mb-3">{t("landing.plansTitle")}</h2>
          <p className="text-muted-foreground">{t("landing.plansSubtitle")}</p>
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
              <div className="mt-3 mb-4">
                <span className="text-4xl font-extrabold">{p.price}</span>
                <span className="text-muted-foreground">{p.period}</span>
              </div>
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

      <footer className="container py-10 text-center text-sm text-muted-foreground">
        {t("landing.footer", { year: new Date().getFullYear() })}
      </footer>
    </div>
  );
};

export default Landing;
