import { Link, useNavigate } from "react-router-dom";
import { ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { LayoutDashboard, Users, Bell, CreditCard, BookOpen, LogOut, Shield, Smartphone, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LanguageToggle } from "@/components/LanguageToggle";

export const AppLayout = ({ children }: { children: ReactNode }) => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [unread, setUnread] = useState(0);
  const [plan, setPlan] = useState<string>("free");

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const [{ count }, { data: sub }] = await Promise.all([
        supabase.from("alerts").select("id", { count: "exact", head: true }).eq("read", false),
        supabase.from("subscriptions").select("plan").eq("user_id", user.id).maybeSingle(),
      ]);
      setUnread(count ?? 0);
      if (sub?.plan) setPlan(sub.plan);
    };
    load();
    const ch = supabase.channel("alerts-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts", filter: `parent_id=eq.${user.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const nav = [
    { to: "/dashboard", icon: LayoutDashboard, label: t("nav.dashboard") },
    { to: "/children", icon: Users, label: t("nav.children") },
    { to: "/devices", icon: Smartphone, label: t("nav.devices") },
    { to: "/alerts", icon: Bell, label: t("nav.alerts"), badge: unread },
    { to: "/rules", icon: Shield, label: t("nav.rules") },
    { to: "/quests", icon: Trophy, label: t("nav.quests") },
    { to: "/learn", icon: BookOpen, label: t("nav.learn") },
    { to: "/pricing", icon: CreditCard, label: t("nav.pricing") },
  ];

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-muted/30">
      <aside className="lg:w-64 lg:min-h-screen border-b lg:border-b-0 lg:border-r bg-background flex flex-col">
        <div className="p-5"><Logo /></div>
        <nav className="px-3 space-y-1">
          {nav.map(item => (
            <Link key={item.to} to={item.to}
              className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm font-medium hover:bg-muted transition-smooth">
              <span className="flex items-center gap-3"><item.icon className="h-4 w-4" /> {item.label}</span>
              {item.badge ? <Badge variant="destructive">{item.badge}</Badge> : null}
            </Link>
          ))}
        </nav>
        <div className="p-4 mt-6 lg:mt-auto space-y-3">
          <LanguageToggle compact />
          <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
          <Badge variant="secondary" className="capitalize">{t("nav.plan", { plan })}</Badge>
          <Button variant="outline" size="sm" className="w-full" onClick={async () => { await signOut(); navigate("/"); }}>
            <LogOut className="h-4 w-4 mr-2" /> {t("nav.logout")}
          </Button>
        </div>
      </aside>
      <main className="flex-1 p-4 lg:p-8 max-w-6xl mx-auto w-full">{children}</main>
    </div>
  );
};
