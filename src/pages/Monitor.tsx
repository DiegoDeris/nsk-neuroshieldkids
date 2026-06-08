// Página de monitoreo web para iOS/Android.
// El padre comparte esta URL al hijo; al abrirla y añadirla al inicio,
// el navegador envía metadatos de comportamiento cada 2 min a ingest-usage.
// Con Service Worker + Periodic Background Sync funciona aunque esté en background.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Shield, Wifi, WifiOff } from "lucide-react";

const INGEST_URL = "https://lqvgspmjfkfdurdnejzs.supabase.co/functions/v1/ingest-usage";
const INTERVAL_MS = 60 * 1000; // 1 minuto mientras está en primer plano
const DB_NAME = "nsk-monitor";
const DB_VERSION = 1;
const STORE = "config";
const SYNC_TAG = "nsk-bg-sync";

// ── sendBeacon (iOS: único método que funciona en pagehide) ───────────────────

function beaconEvent(token: string) {
  if (!token || token.length < 16) return;
  const now = new Date();
  const hour = now.getHours();
  const payload = JSON.stringify({
    token,
    events: [{
      app_name: "Safari iOS",
      duration_seconds: 60,
      occurred_at: now.toISOString(),
      event_type: "app_usage",
      metadata: {
        interactions_per_min: 0,
        visibility_changes: 0,
        orientation_changes: 0,
        is_night: hour >= 22 || hour < 7,
        hour_of_day: hour,
        battery_drain_percent: 0,
        network_type: "unknown",
        session_minutes: 1,
        platform: "ios_web",
        source: "beacon_pagehide",
      },
    }],
  });
  navigator.sendBeacon(INGEST_URL, new Blob([payload], { type: "application/json" }));
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      (e.target as IDBOpenDBRequest).result.createObjectStore(STORE);
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

async function saveToken(token: string) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(token, "token");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Registro SW y periodicSync ────────────────────────────────────────────────

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("/monitor-sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;

    // Periodic Background Sync (Chrome Android)
    if ("periodicSync" in reg) {
      try {
        const status = await (navigator as any).permissions.query({ name: "periodic-background-sync" });
        if (status.state === "granted") {
          await (reg as any).periodicSync.register(SYNC_TAG, { minInterval: 2 * 60 * 1000 });
        }
      } catch { /* no soportado */ }
    }

    // Background Sync one-shot como fallback
    if ("sync" in reg) {
      try { await (reg as any).sync.register(SYNC_TAG); } catch { /* ok */ }
    }
  } catch { /* sw no disponible */ }
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function Monitor() {
  const [params] = useSearchParams();
  const token = params.get("t") ?? "";
  const childName = params.get("n") ?? "tu hijo/a";

  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  // Contadores de señales conductuales
  const taps = useRef(0);
  const visibilityChanges = useRef(0);
  const orientationChanges = useRef(0);
  const sessionStart = useRef(Date.now());
  const batteryStart = useRef<number | null>(null);
  const wakeLock = useRef<any>(null);

  // ── Detectar si ya instalada como PWA ──
  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }
    // Capturar prompt de instalación (Chrome Android)
    const handler = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setIsInstalled(true));
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  // ── Wake Lock ──
  useEffect(() => {
    const acquireWakeLock = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLock.current = await (navigator as any).wakeLock.request("screen");
        }
      } catch { /* denegado */ }
    };
    acquireWakeLock();
    const onVisibility = () => {
      if (document.visibilityState === "visible") acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      wakeLock.current?.release?.().catch(() => {});
    };
  }, []);

  // ── Battery API ──
  useEffect(() => {
    (navigator as any).getBattery?.().then((b: any) => {
      batteryStart.current = b.level * 100;
    }).catch(() => {});
  }, []);

  // ── Contadores de eventos ──
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

  // ── Registrar SW + guardar token en IndexedDB ──
  useEffect(() => {
    if (!token || token.length < 16) return;
    saveToken(token).catch(() => {});
    registerSW();
  }, [token]);

  // ── sendBeacon en pagehide y visibilitychange→hidden (iOS) ──
  useEffect(() => {
    if (!token || token.length < 16) return;
    const onHide = () => beaconEvent(token);
    const onVisHidden = () => { if (document.visibilityState === "hidden") beaconEvent(token); };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisHidden);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisHidden);
    };
  }, [token]);

  // ── Función de envío ──
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
        source: "foreground",
      },
    };

    // Reset contadores
    taps.current = 0;
    visibilityChanges.current = 0;
    orientationChanges.current = 0;
    sessionStart.current = Date.now();

    setStatus("sending");
    try {
      // text/plain evita el CORS preflight (simple request) — el servidor parsea el JSON igual
      const res = await fetch(INGEST_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ token, events: [event] }),
      });
      if (res.ok) {
        setStatus("ok");
        setLastError(null);
        setLastSync(new Date());
      } else {
        let errMsg = `HTTP ${res.status}`;
        try { const j = await res.json(); errMsg += `: ${j.error ?? JSON.stringify(j)}`; } catch {}
        setStatus("error");
        setLastError(errMsg);
      }
    } catch (err: any) {
      setStatus("error");
      setLastError(err?.message ?? "sin conexión");
    }
  };

  // ── Intervalo de envío ──
  useEffect(() => {
    if (!token || token.length < 16) return;
    // Primer envío inmediato — el dashboard muestra "live" al instante
    const initial = setTimeout(sendEvent, 500);
    const interval = setInterval(sendEvent, INTERVAL_MS);
    return () => { clearTimeout(initial); clearInterval(interval); };
  }, [token]);

  // ── Enviar al volver a primer plano ──
  useEffect(() => {
    const handler = () => { if (document.visibilityState === "visible") sendEvent(); };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [token]);

  // ── Instalar PWA ──
  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") {
      setInstallPrompt(null);
      setIsInstalled(true);
    }
  };

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
      {/* Icono */}
      <div className="mb-6">
        <div className="h-24 w-24 rounded-3xl bg-blue-600 flex items-center justify-center shadow-xl mx-auto">
          <Shield className="h-12 w-12 text-white" />
        </div>
      </div>

      <h1 className="text-2xl font-bold text-slate-800 mb-1">NeuroShield Kids</h1>
      <p className="text-slate-500 text-sm mb-8">
        Protegiendo a <strong>{childName}</strong>
      </p>

      {/* Estado */}
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
          <div className={`h-2 w-2 rounded-full ${
            status === "ok" ? "bg-emerald-500" :
            status === "error" ? "bg-red-400" :
            status === "sending" ? "bg-amber-400 animate-pulse" :
            "bg-slate-300"
          }`} />
          <span className="text-xs text-slate-500">
            {status === "ok" && lastSync ? `Último envío: ${lastSync.toLocaleTimeString("es")}` :
             status === "sending" ? "Enviando datos…" :
             status === "error" ? (lastError ?? "Error al enviar. Reintentando…") :
             "Iniciando protección…"}
          </span>
        </div>
      </div>

      {isInstalled ? (
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-5 py-3 w-full max-w-xs mb-4">
          <p className="text-xs font-semibold text-emerald-700">✓ App instalada — monitoreo activo en segundo plano</p>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-3 w-full max-w-xs mb-4">
          <p className="text-xs font-semibold text-amber-700">⚠ Añade esta página a la pantalla de inicio para activar el monitoreo en segundo plano</p>
        </div>
      )}

      <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
        Esta pantalla protege a {childName} en segundo plano. No lee mensajes ni fotos — solo registra patrones de uso.
      </p>

      <div className="mt-8 text-xs text-slate-300">
        Mantén esta app abierta para un monitoreo continuo.
      </div>
    </div>
  );
}
