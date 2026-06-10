import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // El token solo se acepta en el body de un POST (JSON), nunca por query string,
    // para evitar que quede registrado en logs de acceso/URL.
    if (req.method !== "POST") return json({ valid: false, error: "method not allowed" }, 405);

    const body = await req.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token : null;
    if (!token) return json({ valid: false, error: "token required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await admin
      .from("install_tokens")
      .select("id, child_id, expires_at, used_at, children(name, avatar_emoji)")
      .eq("token", token)
      .single();

    if (error || !data) return json({ valid: false });

    const expired = new Date(data.expires_at) < new Date();
    const used = !!data.used_at;
    const child = data.children as any;

    return json({
      valid: !expired && !used,
      expired,
      used,
      child_id: data.child_id,
      child_name: child?.name ?? null,
      child_avatar: child?.avatar_emoji ?? null,
    });
  } catch (err: any) {
    return json({ valid: false, error: err.message }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
