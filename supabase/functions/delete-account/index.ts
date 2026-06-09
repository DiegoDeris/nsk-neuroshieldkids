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

    // 1. Borrar datos de usuario (cascada borra children → usage_events, etc.)
    // Las tablas con FK a children tienen ON DELETE CASCADE
    // Borramos directamente los hijos para garantizar cascada completa
    const { data: children } = await admin
      .from("children")
      .select("id")
      .eq("parent_id", userId);

    if (children && children.length > 0) {
      const childIds = children.map((c: any) => c.id);

      // Borrar datos dependientes explícitamente (por si no hay cascada)
      await admin.from("usage_events").delete().in("child_id", childIds);
      await admin.from("usage_metrics").delete().in("child_id", childIds);
      await admin.from("emotional_scores").delete().in("child_id", childIds);
      await admin.from("recommendations").delete().in("child_id", childIds);
      await admin.from("predictions").delete().in("child_id", childIds);
      await admin.from("alerts").delete().in("child_id", childIds);
      await admin.from("quests").delete().in("child_id", childIds);
      await admin.from("rules").delete().in("child_id", childIds);
      await admin.from("install_tokens").delete().in("child_id", childIds);
      await admin.from("devices").delete().in("child_id", childIds);
      await admin.from("children").delete().in("id", childIds);
    }

    // 2. Borrar datos del padre
    await admin.from("gamification").delete().eq("parent_id", userId);
    await admin.from("subscriptions").delete().eq("user_id", userId);
    await admin.from("profiles").delete().eq("id", userId);

    // 3. Borrar la cuenta de auth (irreversible)
    const { error: deleteErr } = await admin.auth.admin.deleteUser(userId);
    if (deleteErr) {
      console.error("Error borrando usuario auth:", deleteErr);
      return new Response(JSON.stringify({ error: "Error al eliminar la cuenta" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

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
