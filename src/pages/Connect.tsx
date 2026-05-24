import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Check, Loader2, AlertCircle, Smartphone, Activity } from "lucide-react";

const INGEST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest-usage`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
// Intervalo de heartbeat: envía minutos acumulados cada N ms
const HEARTBEAT_MS = 2 * 60 * 1000; // 2 minutos

type Status = "connecting" | "active" | "background" | "error";

async function ingest(token: string, appName: string, seconds: number) {
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
        duration_seconds: Math.round(seconds),
        event_type: "app_usage",
        occurred_at: new Date().toISOString(),
      }],
    }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error((d as any)?.error ?? `HTTP ${res.status}`);
  }
}

export default function Connect() {
  const [params] = useSearchParams();
  const token = params.get("t") ?? params.get("token") ?? "";
  const childName = params.get("n") ?? params.get("child") ?? "";

  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState("");
  const [totalMin, setTotalMin] = useState(0);

  // Tiempo acumulado en foreground desde el último heartbeat
  const activeSecondsRef = useRef(0);
  const lastTickRef = useRef<number>(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const visibleRef = useRef(!document.hidden);

  // Acumula tiempo mientras la pestaña está visible
  const tick = () => {
    const now = Date.now();
    const elapsed = (now - lastTickRef.current) / 1000;
    lastTickRef.current = now;
    if (visibleRef.current) {
      activeSecondsRef.current += elapsed;
    }
  };

  // Envía lo acumulado y resetea el contador
  const flush = async (label = "Móvil monitorizado") => {
    tick();
    const secs = activeSecondsRef.current;
    activeSecondsRef.current = 0;
    if (secs < 5) return; // nada relevante
    await ingest(token, label, secs);
    setTotalMin(m => m + Math.round(secs / 60));
  };

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("Token no válido. Pide a tu adulto que regenere el QR.");
      return;
    }

    // Conexión inicial
    (async () => {
      try {
        await ingest(token, "Conexión inicial", 1);
        setStatus(document.hidden ? "background" : "active");
      } catch (e: any) {
        setStatus("error");
        setError(e?.message ?? "No se pudo conectar.");
        return;
      }

      // Heartbeat periódico
      lastTickRef.current = Date.now();
      intervalRef.current = setInterval(async () => {
        try { await flush(); } catch { /* silencioso */ }
      }, HEARTBEAT_MS);

      // Visibilidad: pausa/reanuda el contador
      const onVis = () => {
        tick();
        visibleRef.current = !document.hidden;
        setStatus(document.hidden ? "background" : "active");
        // Si vuelve al frente, envía lo pendiente
        if (!document.hidden) flush().catch(() => {});
      };
      document.addEventListener("visibilitychange", onVis);

      // Al cerrar: envía lo acumulado
      const onUnload = () => { flush().catch(() => {}); };
      window.addEventListener("pagehide", onUnload);
      window.addEventListener("beforeunload", onUnload);

      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        document.removeEventListener("visibilitychange", onVis);
        window.removeEventListener("pagehide", onUnload);
        window.removeEventListener("beforeunload", onUnload);
        flush().catch(() => {});
      };
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 text-center space-y-6">
        <div className="flex justify-center">
          <div className={`h-16 w-16 rounded-2xl flex items-center justify-center transition-colors ${
            status === "active" ? "bg-emerald-100" :
            status === "background" ? "bg-amber-100" :
            status === "error" ? "bg-destructive/10" : "bg-primary/10"
          }`}>
            {status === "connecting" ? (
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
            ) : status === "error" ? (
              <AlertCircle className="h-8 w-8 text-destructive" />
            ) : (
              <Smartphone className={`h-8 w-8 ${status === "active" ? "text-emerald-600" : "text-amber-500"}`} />
            )}
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-bold">
            {childName ? `Dispositivo de ${childName}` : "Dispositivo monitorizado"}
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            {status === "connecting" && "Conectando con la cuenta familiar…"}
            {status === "active" && "Monitorización activa. Mantén esta pestaña abierta."}
            {status === "background" && "Pantalla en reposo. Los datos se enviarán al volver."}
            {status === "error" && error}
          </p>
        </div>

        <div className="rounded-xl border p-4 bg-muted/30 space-y-3">
          {status === "active" && (
            <div className="flex items-center justify-center gap-2 text-emerald-600 font-medium">
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
          {status === "error" && (
            <div className="flex items-center justify-center gap-2 text-destructive font-medium">
              <AlertCircle className="h-4 w-4" /> Error de conexión
            </div>
          )}
          {totalMin > 0 && (
            <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
              <Check className="h-3 w-3 text-emerald-500" />
              {totalMin} min enviados hoy
            </div>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Solo se envían metadatos de uso. Sin cuentas, sin spyware.
        </p>
      </Card>
    </div>
  );
}
