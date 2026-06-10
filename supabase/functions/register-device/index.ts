import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { install_token, device_info } = await req.json();
    if (!install_token) return json({ error: "install_token required" }, 400);

    const fingerprint = typeof device_info?.fingerprint === "string" ? device_info.fingerprint.trim() : "";
    if (!fingerprint) return json({ error: "device_info.fingerprint required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate token exists and is not expired
    const { data: tokenCheck, error: tokenCheckErr } = await admin
      .from("install_tokens")
      .select("id, child_id, parent_id, expires_at, used_at, children(name, ingest_token)")
      .eq("token", install_token)
      .single();

    if (tokenCheckErr || !tokenCheck) return json({ error: "Invalid token" }, 401);
    if (new Date(tokenCheck.expires_at) < new Date()) return json({ error: "Token expired" }, 410);

    // Marcar el token como usado de forma atómica — si no devuelve fila,
    // ya fue usado por otra request concurrente o ya no es válido.
    const { data: claimed, error: claimErr } = await admin
      .from("install_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("token", install_token)
      .is("used_at", null)
      .select("id, child_id, parent_id, expires_at, used_at, children(name, ingest_token)")
      .single();

    if (claimErr || !claimed) return json({ error: "Token already used" }, 410);

    const tokenRow = claimed;
    const child = tokenRow.children as any;
    let ingestToken: string = child?.ingest_token;

    // Generate ingest_token if child doesn't have one
    if (!ingestToken) {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      ingestToken = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
      await admin
        .from("children")
        .update({ ingest_token: ingestToken })
        .eq("id", tokenRow.child_id);
    }

    // Upsert device record (device_fingerprint validado como no vacío arriba)
    await admin.from("devices").upsert({
      child_id: tokenRow.child_id,
      parent_id: tokenRow.parent_id,
      device_model: device_info?.model ?? null,
      android_version: device_info?.android_version ?? null,
      device_fingerprint: fingerprint,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "device_fingerprint" });

    // Update child last_ingest_at → triggers real-time in dashboard modal
    await admin
      .from("children")
      .update({ last_ingest_at: new Date().toISOString() })
      .eq("id", tokenRow.child_id);

    return json({
      success: true,
      child_id: tokenRow.child_id,
      child_name: child?.name ?? null,
      ingest_token: ingestToken,
    });
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
