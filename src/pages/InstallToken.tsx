import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { Download, Shield, CheckCircle2, AlertCircle, Loader2, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const APK_URL = "https://github.com/DiegoDeris/nsk-android/releases/latest/download/app-debug.apk";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const VALIDATE_FN = `${SUPABASE_URL}/functions/v1/validate-install-token`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type TokenInfo = {
  valid: boolean;
  expired?: boolean;
  used?: boolean;
  child_name?: string | null;
  child_avatar?: string | null;
};

export default function InstallToken() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<"download" | "scan">("download");

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    fetch(`${VALIDATE_FN}?token=${encodeURIComponent(token)}`, {
      headers: { apikey: ANON_KEY },
    })
      .then(r => r.json())
      .then((d: TokenInfo) => { setInfo(d); setLoading(false); })
      .catch(() => { setInfo({ valid: false }); setLoading(false); });
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!token || !info?.valid) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8FAFC] px-6 text-center gap-4">
        <AlertCircle className="h-14 w-14 text-amber-400" />
        <h1 className="text-xl font-bold text-slate-800">
          {info?.expired ? "Enlace caducado" : info?.used ? "Ya configurado" : "Enlace no válido"}
        </h1>
        <p className="text-slate-500 text-sm max-w-xs">
          {info?.expired
            ? "Este QR ha expirado. Pide al padre/madre que genere uno nuevo desde el panel."
            : info?.used
            ? "Este dispositivo ya fue vinculado. Si tienes problemas, genera un nuevo QR."
            : "Escanea el QR directamente desde el panel parental de NeuroShield Kids."}
        </p>
      </div>
    );
  }

  const childName = info.child_name ?? "tu hijo/a";
  const childAvatar = info.child_avatar ?? "🧒";
  // Deep link URI that the Android app intercepts
  const setupUri = `nsk://setup/${token}`;

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center px-5 py-12 max-w-sm mx-auto">

      {/* Avatar + name */}
      <div className="text-5xl mb-2">{childAvatar}</div>
      <h1 className="text-2xl font-bold text-slate-800 mt-2">{childName}</h1>
      <p className="text-slate-400 text-sm mt-1 mb-10">NeuroShield Kids</p>

      {step === "download" && (
        <>
          {/* Big download CTA */}
          <a
            href={APK_URL}
            download
            className="w-full mb-3"
            onClick={() => setTimeout(() => setStep("scan"), 1200)}
          >
            <Button
              size="lg"
              className="w-full gap-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl h-14 text-base shadow-lg shadow-blue-200"
            >
              <Download className="h-5 w-5" />
              Descargar NeuroShield Kids
            </Button>
          </a>

          <p className="text-xs text-slate-400 text-center mb-6">
            Android · gratis · sin publicidad
          </p>

          {/* Minimal steps */}
          <div className="w-full space-y-3 mb-8">
            {[
              { n: "1", text: "Descarga e instala la app" },
              { n: "2", text: 'Si pide permiso, activa "fuentes desconocidas"' },
              { n: "3", text: "Abre la app y escanea el QR" },
            ].map(s => (
              <div key={s.n} className="flex items-center gap-3">
                <div className="h-7 w-7 rounded-full bg-blue-100 text-blue-600 text-xs font-bold flex items-center justify-center shrink-0">
                  {s.n}
                </div>
                <span className="text-sm text-slate-600">{s.text}</span>
              </div>
            ))}
          </div>

          <button
            onClick={() => setStep("scan")}
            className="text-sm text-blue-500 font-medium"
          >
            Ya tengo la app instalada →
          </button>
        </>
      )}

      {step === "scan" && (
        <>
          <div className="w-full bg-white rounded-3xl shadow-sm border border-slate-100 p-6 flex flex-col items-center mb-6">
            <p className="text-sm font-semibold text-slate-700 mb-1 text-center">
              Escanea desde la app
            </p>
            <p className="text-xs text-slate-400 text-center mb-5">
              Pulsa "Escanear QR" dentro de NeuroShield Kids
            </p>
            <div className="p-3 bg-white rounded-2xl border-2 border-slate-100 shadow-inner">
              <QRCodeSVG value={setupUri} size={200} level="M" />
            </div>
          </div>

          <button
            onClick={() => setStep("download")}
            className="flex items-center gap-1 text-xs text-slate-400"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Volver a descargar
          </button>
        </>
      )}

      {/* Privacy footer */}
      <div className="flex items-center gap-2 text-xs text-slate-300 mt-auto pt-10">
        <Shield className="h-3.5 w-3.5" />
        <span>Sin mensajes ni fotos. Solo tiempo de pantalla.</span>
      </div>
    </div>
  );
}
