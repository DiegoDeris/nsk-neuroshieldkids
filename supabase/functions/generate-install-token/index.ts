import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    // Verify caller identity
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { authorization: authHeader } } }
    );
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { child_id } = await req.json();
    if (!child_id) return json({ error: "child_id required" }, 400);

    // Verify ownership
    const { data: child, error: childErr } = await userClient
      .from("children")
      .select("id, name")
      .eq("id", child_id)
      .eq("parent_id", user.id)
      .single();
    if (childErr || !child) return json({ error: "Child not found" }, 404);

    // Use service role for writes
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Invalidate any existing unused tokens for this child
    await admin
      .from("install_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("child_id", child_id)
      .is("used_at", null);

    // Generate URL-safe base64 token (24 random bytes → 32 chars)
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    const expires_at = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    const { error: insertErr } = await admin.from("install_tokens").insert({
      token,
      child_id,
      parent_id: user.id,
      expires_at,
    });
    if (insertErr) throw insertErr;

    const url = `https://nsk-neuroshieldkids.vercel.app/install/${token}`;

    return json({ token, url, expires_at });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
