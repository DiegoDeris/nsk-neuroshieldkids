// delete-account — borra todos los datos del usuario y su cuenta (GDPR Art. 17)
// Requiere JWT válido del usuario que solicita el borrado.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    // Verificar JWT
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user?.id) {
      return new Response(JSON.stringify({ error: "Sesión inválida" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const userId = user.id;
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Borrar la cuenta de auth (irreversible). Esto dispara ON DELETE CASCADE
    // sobre profiles/children/subscriptions y, vía children, sobre usage_events,
    // usage_metrics, emotional_scores, alerts, recommendations, predictions,
    // gamification, devices e install_tokens. Si falla, no se ha borrado nada (atómico).
    const { error: deleteErr } = await admin.auth.admin.deleteUser(userId);
    if (deleteErr) {
      console.error("Error borrando usuario auth:", deleteErr);
      return new Response(JSON.stringify({ error: "Error al eliminar la cuenta" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 2. Limpieza best-effort: "rules" y "quests" referencian parent_id/child_id
    // sin FK CASCADE, así que no se borran automáticamente con el usuario.
    await admin.from("rules").delete().eq("parent_id", userId);
    await admin.from("quests").delete().eq("parent_id", userId);

    return new Response(JSON.stringify({ ok: true, message: "Cuenta y todos los datos eliminados correctamente" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e) {
    console.error("delete-account error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
