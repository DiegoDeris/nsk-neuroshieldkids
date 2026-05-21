import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Sparkles } from "lucide-react";
import { toast } from "sonner";

const Pricing = () => {
  const { t } = useTranslation();
  const plans = [
    { id: "free", name: t("plans.free.name"), price: "0€", period: t("plans.free.period"),
      perks: [t("plans.free.p1"), t("plans.free.p2"), t("plans.free.p3")],
      cta: t("plans.free.current"), disabled: true },
    { id: "basic", name: t("plans.basic.name"), price: "12€", period: t("plans.basic.period"),
      perks: [t("plans.basic.p1"), t("plans.basic.p2"), t("plans.basic.p3"), t("plans.basic.p4")],
      cta: t("plans.basic.ctaStart"), highlight: false },
    { id: "premium", name: t("plans.premium.name"), price: "29€", period: t("plans.premium.period"),
      perks: [t("plans.premium.p1"), t("plans.premium.p2"), t("plans.premium.p3"), t("plans.premium.p4"), t("plans.premium.p5"), t("plans.premium.p6")],
      cta: t("plans.premium.ctaStart"), highlight: true },
  ];
  return (
    <AppLayout>
      <div className="text-center max-w-2xl mx-auto mb-10">
        <h1 className="text-4xl font-bold mb-3">{t("pricing.title")}</h1>
        <p className="text-muted-foreground">{t("pricing.subtitle")}</p>
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
            <Button
              className={`w-full ${p.highlight ? "shadow-glow" : ""}`}
              variant={p.highlight ? "default" : "outline"}
              disabled={p.disabled}
              onClick={() => toast.info(t("plans.stripeNotice"))}
            >
              {p.disabled ? p.cta : (<><Sparkles className="h-4 w-4 mr-2" /> {p.cta}</>)}
            </Button>
          </Card>
        ))}
      </div>
    </AppLayout>
  );
};

export default Pricing;
