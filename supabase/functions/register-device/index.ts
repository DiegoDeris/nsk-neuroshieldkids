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

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate token
    const { data: tokenRow, error: tokenErr } = await admin
      .from("install_tokens")
      .select("id, child_id, parent_id, expires_at, used_at, children(name, ingest_token)")
      .eq("token", install_token)
      .single();

    if (tokenErr || !tokenRow) return json({ error: "Invalid token" }, 400);
    if (tokenRow.used_at) return json({ error: "Token already used" }, 400);
    if (new Date(tokenRow.expires_at) < new Date()) return json({ error: "Token expired" }, 400);

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

    // Upsert device record
    if (device_info?.fingerprint) {
      await admin.from("devices").upsert({
        child_id: tokenRow.child_id,
        parent_id: tokenRow.parent_id,
        device_model: device_info.model ?? null,
        android_version: device_info.android_version ?? null,
        device_fingerprint: device_info.fingerprint,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: "device_fingerprint" });
    } else {
      await admin.from("devices").insert({
        child_id: tokenRow.child_id,
        parent_id: tokenRow.parent_id,
        device_model: device_info?.model ?? null,
        android_version: device_info?.android_version ?? null,
        last_seen_at: new Date().toISOString(),
      });
    }

    // Mark token as used
    await admin
      .from("install_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("id", tokenRow.id);

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
      supabase_url: Deno.env.get("SUPABASE_URL"),
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
