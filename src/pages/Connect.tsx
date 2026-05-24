/**
 * Página de monitorización web.
 * Máxima recolección de señales conductuales posibles desde un navegador móvil:
 * - Tiempo activo / nocturno (Page Visibility API)
 * - Frecuencia de interacción (taps, clics, scroll) → proxy de uso compulsivo
 * - Cambios de visibilidad → conmutación de apps / ansiedad
 * - Batería (Battery API) → intensidad de uso
 * - Tipo de red (Network Info API)
 * - Orientación del dispositivo
 * Todo se envía como metadata al ingest-usage junto con el tiempo acumulado.
 */
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Check, Loader2, AlertCircle, Smartphone, Activity } from "lucide-react";

const INGEST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest-usage`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const HEARTBEAT_MS = 90 * 1000; // cada 90 s para mejor granularidad

type Status = "connecting" | "active" | "background" | "error";

// ─── helpers de APIs opcionales ──────────────────────────────────────────────
function getBatteryLevel(): Promise<number | null> {
  const nav = navigator as any;
  if (!nav.getBattery) return Promise.resolve(null);
  return nav.getBattery().then((b: any) => Math.round(b.level * 100)).catch(() => null);
}
function getNetworkType(): string {
  const conn = (navigator as any).connection;
  return conn?.effectiveType ?? conn?.type ?? "unknown";
}
function getOrientation(): string {
  return screen.orientation?.type ?? (window.innerWidth > window.innerHeight ? "landscape" : "portrait");
}

// ─── ingest ──────────────────────────────────────────────────────────────────
async function ingest(token: string, appName: string, seconds: number, meta: Record<string, unknown>) {
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ANON_KEY}`,
      "apikey": ANON_KEY,
    },
    body: JSON.stringify({
      token,
      events: [{
        app_name: appName,
        duration_seconds: Math.max(1, Math.round(seconds)),
        event_type: "app_usage",
        occurred_at: new Date().toISOString(),
        metadata: meta,
      }],
    }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error((d as any)?.error ?? `HTTP ${res.status}`);
  }
}

// ─── componente ──────────────────────────────────────────────────────────────
export default function Connect() {
  const [params] = useSearchParams();
  const token = params.get("t") ?? params.get("token") ?? "";
  const childName = params.get("n") ?? params.get("child") ?? "";

  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState("");
  const [totalMin, setTotalMin] = useState(0);

  // contadores de señales conductuales
  const activeSecondsRef = useRef(0);
  const lastTickRef = useRef(Date.now());
  const visibleRef = useRef(!document.hidden);
  const interactionsRef = useRef(0);      // taps / clics / scroll
  const visChangesRef = useRef(0);        // conmutaciones de app
  const orientChangesRef = useRef(0);     // cambios de orientación
  const sessionStartRef = useRef(Date.now());
  const batteryStartRef = useRef<number | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tick = () => {
    const now = Date.now();
    const elapsed = (now - lastTickRef.current) / 1000;
    lastTickRef.current = now;
    if (visibleRef.current) activeSecondsRef.current += elapsed;
  };

  const flush = async () => {
    tick();
    const secs = activeSecondsRef.current;
    activeSecondsRef.current = 0;
    if (secs < 5) return;

    const sessionMinutes = Math.round((Date.now() - sessionStartRef.current) / 60000);
    const intPerMin = secs > 0 ? Math.round((interactionsRef.current / secs) * 60) : 0;
    const batteryNow = await getBatteryLevel();
    const batteryDrain = batteryStartRef.current != null && batteryNow != null
      ? batteryStartRef.current - batteryNow : null;

    // Nombre descriptivo del tipo de uso
    const hour = new Date().getHours();
    const isNight = hour >= 22 || hour < 7;
    const appLabel = isNight ? "Uso nocturno" :
      intPerMin > 20 ? "Uso intensivo" :
      visChangesRef.current > 3 ? "Uso fragmentado" : "Uso normal";

    await ingest(token, appLabel, secs, {
      interactions_per_min: intPerMin,
      visibility_changes: visChangesRef.current,
      orientation_changes: orientChangesRef.current,
      session_minutes: sessionMinutes,
      network_type: getNetworkType(),
      orientation: getOrientation(),
      battery_drain_percent: batteryDrain,
      is_night: isNight,
      hour_of_day: hour,
    });

    // reset contadores parciales (no los totales de sesión)
    interactionsRef.current = 0;
    visChangesRef.current = 0;
    orientChangesRef.current = 0;
    batteryStartRef.current = batteryNow;
    setTotalMin(m => m + Math.round(secs / 60));
  };

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("Token no válido. Pide a tu adulto que regenere el QR.");
      return;
    }

    let cleanup: (() => void) | undefined;

    (async () => {
      // Batería inicial
      batteryStartRef.current = await getBatteryLevel();

      // Evento de sesión inicial
      try {
        await ingest(token, "Inicio de sesión", 1, {
          network_type: getNetworkType(),
          orientation: getOrientation(),
          battery_level: batteryStartRef.current,
          hour_of_day: new Date().getHours(),
          is_night: new Date().getHours() >= 22 || new Date().getHours() < 7,
        });
        setStatus(document.hidden ? "background" : "active");
      } catch (e: any) {
        setStatus("error");
        setError(e?.message ?? "No se pudo conectar.");
        return;
      }

      lastTickRef.current = Date.now();
      sessionStartRef.current = Date.now();

      // Heartbeat
      heartbeatRef.current = setInterval(() => { flush().catch(() => {}); }, HEARTBEAT_MS);

      // Visibilidad (conmutación de app)
      const onVis = () => {
        tick();
        visibleRef.current = !document.hidden;
        visChangesRef.current++;
        setStatus(document.hidden ? "background" : "active");
        if (!document.hidden) flush().catch(() => {});
      };
      document.addEventListener("visibilitychange", onVis);

      // Interacciones
      const countInteraction = () => { interactionsRef.current++; };
      ["touchstart", "click", "scroll"].forEach(ev =>
        document.addEventListener(ev, countInteraction, { passive: true })
      );

      // Orientación
      const onOrient = () => { orientChangesRef.current++; };
      screen.orientation?.addEventListener("change", onOrient);

      // Cierre de página
      const onUnload = () => { flush().catch(() => {}); };
      window.addEventListener("pagehide", onUnload);
      window.addEventListener("beforeunload", onUnload);

      cleanup = () => {
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        document.removeEventListener("visibilitychange", onVis);
        ["touchstart", "click", "scroll"].forEach(ev =>
          document.removeEventListener(ev, countInteraction)
        );
        screen.orientation?.removeEventListener("change", onOrient);
        window.removeEventListener("pagehide", onUnload);
        window.removeEventListener("beforeunload", onUnload);
        flush().catch(() => {});
      };
    })();

    return () => cleanup?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-sm w-full p-8 text-center space-y-6">
        <div className="flex justify-center">
          <div className={`h-16 w-16 rounded-2xl flex items-center justify-center transition-colors ${
            status === "active"     ? "bg-emerald-100" :
            status === "background" ? "bg-amber-100"   :
            status === "error"      ? "bg-destructive/10" : "bg-primary/10"
          }`}>
            {status === "connecting" ? <Loader2 className="h-8 w-8 text-primary animate-spin" /> :
             status === "error"      ? <AlertCircle className="h-8 w-8 text-destructive" /> :
             <Smartphone className={`h-8 w-8 ${status === "active" ? "text-emerald-600" : "text-amber-500"}`} />}
          </div>
        </div>

        <div>
          <h1 className="text-xl font-bold">
            {childName ? `Dispositivo de ${childName}` : "Dispositivo conectado"}
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            {status === "connecting" && "Conectando…"}
            {status === "active"     && "Monitorización activa. Mantén esta pestaña abierta."}
            {status === "background" && "Pantalla en reposo. Los datos se sincronizarán al volver."}
            {status === "error"      && error}
          </p>
        </div>

        <div className="rounded-xl border p-4 bg-muted/30 space-y-2">
          {status === "active" && (
            <div className="flex items-center justify-center gap-2 text-emerald-600 font-medium text-sm">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </span>
              En vivo
            </div>
          )}
          {status === "background" && (
            <div className="flex items-center justify-center gap-2 text-amber-600 font-medium text-sm">
              <Activity className="h-4 w-4" /> Esperando actividad…
            </div>
          )}
          {status === "connecting" && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Conectando…
            </div>
          )}
          {totalMin > 0 && (
            <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
              <Check className="h-3 w-3 text-emerald-500" /> {totalMin} min enviados hoy
            </div>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Solo se envían metadatos de comportamiento. Sin cuentas, sin spyware.
        </p>
      </Card>
    </div>
  );
}
