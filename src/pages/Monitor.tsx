// Página de monitoreo web para iOS (y cualquier dispositivo).
// El padre comparte esta URL al hijo; al abrirla en Safari y añadirla al inicio,
// el navegador envía metadatos de comportamiento cada 5 min a ingest-usage.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Shield, Wifi, WifiOff } from "lucide-react";

const INGEST_URL = "https://lqvgspmjfkfdurdnejzs.supabase.co/functions/v1/ingest-usage";
const INTERVAL_MS = 5 * 60 * 1000;

export default function Monitor() {
  const [params] = useSearchParams();
  const token = params.get("t") ?? "";
  const childName = params.get("n") ?? "tu hijo/a";

  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "error">("idle");

  const taps = useRef(0);
  const visibilityChanges = useRef(0);
  const orientationChanges = useRef(0);
  const sessionStart = useRef(Date.now());
  const batteryStart = useRef<number | null>(null);

  useEffect(() => {
    (navigator as any).getBattery?.().then((b: any) => {
      batteryStart.current = b.level * 100;
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const onTap = () => { taps.current++; };
    const onVisibility = () => { visibilityChanges.current++; };
    const onOrientation = () => { orientationChanges.current++; };
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);

    document.addEventListener("touchstart", onTap, { passive: true });
    document.addEventListener("click", onTap, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("orientationchange", onOrientation);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      document.removeEventListener("touchstart", onTap);
      document.removeEventListener("click", onTap);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("orientationchange", onOrientation);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const sendEvent = async () => {
    if (!token || token.length < 16) return;
    if (!navigator.onLine) return;

    const now = new Date();
    const hour = now.getHours();
    const sessionMin = Math.round((Date.now() - sessionStart.current) / 60000);

    let batteryDrain = 0;
    try {
      const b = await (navigator as any).getBattery?.();
      if (b && batteryStart.current !== null) {
        batteryDrain = Math.max(0, batteryStart.current - b.level * 100);
        batteryStart.current = b.level * 100;
      }
    } catch {}

    const interactionsPerMin = sessionMin > 0 ? Math.round(taps.current / sessionMin) : taps.current;

    const event = {
      app_name: "Safari iOS",
      duration_seconds: sessionMin * 60,
      occurred_at: now.toISOString(),
      event_type: "app_usage",
      metadata: {
        interactions_per_min: interactionsPerMin,
        visibility_changes: visibilityChanges.current,
        orientation_changes: orientationChanges.current,
        is_night: hour >= 22 || hour < 7,
        hour_of_day: hour,
        battery_drain_percent: batteryDrain,
        network_type: (navigator as any).connection?.effectiveType ?? "unknown",
        session_minutes: sessionMin,
        platform: "ios_web",
      },
    };

    taps.current = 0;
    visibilityChanges.current = 0;
    orientationChanges.current = 0;
    sessionStart.current = Date.now();

    setStatus("sending");
    try {
      const res = await fetch(INGEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, events: [event] }),
      });
      setStatus(res.ok ? "ok" : "error");
      if (res.ok) setLastSync(new Date());
    } catch {
      setStatus("error");
    }
  };

  useEffect(() => {
    if (!token || token.length < 16) return;
    const initial = setTimeout(sendEvent, 30_000);
    const interval = setInterval(sendEvent, INTERVAL_MS);
    return () => { clearTimeout(initial); clearInterval(interval); };
  }, [token]);

  useEffect(() => {
    const handler = () => { if (document.visibilityState === "visible") sendEvent(); };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [token]);

  if (!token || token.length < 16) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6 text-center">
        <div>
          <p className="text-slate-500 text-sm">Enlace de configuración incompleto.</p>
          <p className="text-slate-400 text-xs mt-1">Pide al padre/madre que genere un nuevo QR desde el panel.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col items-center justify-center px-6 text-center select-none">
      <div className="mb-6">
        <div className="h-24 w-24 rounded-3xl bg-blue-600 flex items-center justify-center shadow-xl mx-auto">
          <Shield className="h-12 w-12 text-white" />
        </div>
      </div>

      <h1 className="text-2xl font-bold text-slate-800 mb-1">NeuroShield Kids</h1>
      <p className="text-slate-500 text-sm mb-8">
        Protegiendo a <strong>{childName}</strong>
      </p>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 px-6 py-4 w-full max-w-xs mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">Estado</span>
          <div className="flex items-center gap-1.5">
            {online
              ? <Wifi className="h-3.5 w-3.5 text-emerald-500" />
              : <WifiOff className="h-3.5 w-3.5 text-slate-400" />}
            <span className={`text-xs font-semibold ${online ? "text-emerald-600" : "text-slate-400"}`}>
              {online ? "Conectado" : "Sin conexión"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${status === "ok" ? "bg-emerald-500" : status === "error" ? "bg-red-400" : status === "sending" ? "bg-amber-400 animate-pulse" : "bg-slate-300"}`} />
          <span className="text-xs text-slate-500">
            {status === "ok" && lastSync ? `Último envío: ${lastSync.toLocaleTimeString("es")}` :
             status === "sending" ? "Enviando datos…" :
             status === "error" ? "Error al enviar. Reintentando…" :
             "Iniciando protección…"}
          </span>
        </div>
      </div>

      <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
        Esta pantalla protege a {childName} en segundo plano. No leas mensajes ni fotos — solo registra patrones de uso.
      </p>

      <div className="mt-8 text-xs text-slate-300">
        Mantén esta app abierta en Safari para un monitoreo continuo.
      </div>
    </div>
  );
}
