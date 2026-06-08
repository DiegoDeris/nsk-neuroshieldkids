import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const PRICES = {
  basic:   { monthly: 8.99,  annual: 79,  annualMonthly: 6.58 },
  premium: { monthly: 14.99, annual: 119, annualMonthly: 9.92 },
};

const Pricing = () => {
  const { t } = useTranslation();
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const [loading, setLoading] = useState<string | null>(null);

  const handleCheckout = async (planId: string) => {
    if (planId === "free") return;
    setLoading(planId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error("Inicia sesión para suscribirte"); return; }

      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { plan: planId, interval: billing },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
      else throw new Error("No se pudo crear la sesión de pago");
    } catch (e: any) {
      toast.error(e.message ?? "Error al iniciar el pago");
    } finally {
      setLoading(null);
    }
  };

  const plans = [
    {
      id: "free",
      name: t("plans.free.name"),
      price: "0€",
      period: t("plans.free.period"),
      perks: [t("plans.free.p1"), t("plans.free.p2"), t("plans.free.p3"), t("plans.free.p4")],
      cta: t("plans.free.current"),
      disabled: true,
    },
    {
      id: "basic",
      name: t("plans.basic.name"),
      price: billing === "monthly" ? `${PRICES.basic.monthly}€` : `${PRICES.basic.annualMonthly}€`,
      period: "/mes",
      annualNote: billing === "annual" ? `${PRICES.basic.annual}€/año` : null,
      perks: [t("plans.basic.p1"), t("plans.basic.p2"), t("plans.basic.p3"), t("plans.basic.p4"), t("plans.basic.p5"), t("plans.basic.p6")],
      cta: t("plans.basic.ctaStart"),
    },
    {
      id: "premium",
      name: t("plans.premium.name"),
      price: billing === "monthly" ? `${PRICES.premium.monthly}€` : `${PRICES.premium.annualMonthly}€`,
      period: "/mes",
      annualNote: billing === "annual" ? `${PRICES.premium.annual}€/año` : null,
      perks: [t("plans.premium.p1"), t("plans.premium.p2"), t("plans.premium.p3"), t("plans.premium.p4"), t("plans.premium.p5"), t("plans.premium.p6"), t("plans.premium.p7"), t("plans.premium.p8")],
      cta: t("plans.premium.ctaStart"),
      highlight: true,
    },
  ];

  return (
    <AppLayout>
      <div className="text-center max-w-2xl mx-auto mb-8">
        <h1 className="text-4xl font-bold mb-3">{t("pricing.title")}</h1>
        <p className="text-muted-foreground mb-6">{t("pricing.subtitle")}</p>

        {/* Toggle mensual / anual */}
        <div className="inline-flex items-center bg-muted rounded-full p-1 gap-1">
          <button
            onClick={() => setBilling("monthly")}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${
              billing === "monthly" ? "bg-background shadow text-foreground" : "text-muted-foreground"
            }`}
          >
            {t("plans.monthly")}
          </button>
          <button
            onClick={() => setBilling("annual")}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition-all flex items-center gap-2 ${
              billing === "annual" ? "bg-background shadow text-foreground" : "text-muted-foreground"
            }`}
          >
            {t("plans.annual")}
            <span className="text-xs bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full">−30%</span>
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {plans.map(p => (
          <Card key={p.id} className={`p-6 relative ${p.highlight ? "border-primary shadow-glow" : ""}`}>
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
            {p.annualNote && (
              <p className="text-xs text-emerald-600 font-semibold mb-3">{p.annualNote} · Ahorra ~2 meses</p>
            )}
            {!p.annualNote && <div className="mb-3" />}
            <ul className="space-y-2 mb-6">
              {p.perks.map(perk => (
                <li key={perk} className="flex items-start gap-2 text-sm">
                  <Check className="h-4 w-4 text-success mt-0.5 shrink-0" />
                  <span>{perk}</span>
                </li>
              ))}
            </ul>
            <Button
              className={`w-full ${p.highlight ? "shadow-glow" : ""}`}
              variant={p.highlight ? "default" : "outline"}
              disabled={p.disabled || loading === p.id}
              onClick={() => handleCheckout(p.id)}
            >
              {p.disabled ? p.cta : loading === p.id ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Redirigiendo…</> : <><Sparkles className="h-4 w-4 mr-2" />{p.cta}</>}
            </Button>
          </Card>
        ))}
      </div>
    </AppLayout>
  );
};

export default Pricing;
