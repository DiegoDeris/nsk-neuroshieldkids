import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type Plan = "free" | "basic" | "premium";

export interface PlanLimits {
  maxChildren: number;       // free=1, basic=3, premium=Infinity
  historyDays: number;       // free=3, basic=30, premium=Infinity
  aiAnalysis: boolean;       // free=false, basic=false, premium=true
  alerts: "count" | "full";  // free=count only, basic/premium=full detail
  rules: boolean;            // free=false, basic/premium=true
  pdfReports: boolean;       // premium only
}

const LIMITS: Record<Plan, PlanLimits> = {
  free:    { maxChildren: 1,        historyDays: 3,        aiAnalysis: false, alerts: "count",  rules: false, pdfReports: false },
  basic:   { maxChildren: 3,        historyDays: 30,       aiAnalysis: false, alerts: "full",   rules: true,  pdfReports: false },
  premium: { maxChildren: Infinity, historyDays: Infinity, aiAnalysis: true,  alerts: "full",   rules: true,  pdfReports: true  },
};

export function useSubscription() {
  const { user } = useAuth();
  const [plan, setPlan] = useState<Plan>("free");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    supabase
      .from("subscriptions")
      .select("plan, status")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const p = (data?.status === "active" ? data?.plan : "free") as Plan;
        setPlan(LIMITS[p] ? p : "free");
        setLoading(false);
      });
  }, [user]);

  return { plan, limits: LIMITS[plan], loading };
}
