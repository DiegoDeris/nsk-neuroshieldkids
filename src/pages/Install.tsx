import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { Download, Smartphone, QrCode, Shield, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const APK_URL = "https://github.com/DiegoDeris/nsk-android/releases/latest/download/app-debug.apk";

export default function Install() {
  const [params] = useSearchParams();
  const token = params.get("t") ?? "";
  const childName = params.get("n") ?? "tu hijo/a";

  const hasToken = token.length >= 16;

  const steps = useMemo(() => [
    {
      icon: <Download className="h-6 w-6 text-blue-500" />,
      title: "Descarga la app",
      body: "Pulsa el botón de abajo para descargar NeuroShield Kids (APK Android).",
    },
    {
      icon: <Smartphone className="h-6 w-6 text-violet-500" />,
      title: "Instala el APK",
      body: 'Si Android pide confirmación, ve a Ajustes → Seguridad → "Instalar apps desconocidas" y actívalo.',
    },
    {
      icon: <QrCode className="h-6 w-6 text-emerald-500" />,
      title: "Escanea el QR de configuración",
      body: "Abre NeuroShield Kids, pulsa \"Escanear QR\" y apunta la cámara al código de abajo.",
    },
  ], []);

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center px-4 py-10">
      <div className="flex flex-col items-center mb-8 text-center">
        <span className="text-6xl mb-3">🛡️</span>
        <h1 className="text-2xl font-bold text-slate-800">NeuroShield Kids</h1>
        <p className="text-slate-500 text-sm mt-1">
          Configura la protección pasiva para <strong>{childName}</strong>
        </p>
      </div>

      <a href={APK_URL} download className="w-full max-w-sm mb-6">
        <Button size="lg" className="w-full gap-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl h-14 text-base shadow-lg">
          <Download className="h-5 w-5" />
          Descargar app Android (APK)
        </Button>
      </a>

      <Card className="w-full max-w-sm p-5 rounded-3xl shadow-sm mb-6">
        <div className="space-y-5">
          {steps.map((s, i) => (
            <div key={i} className="flex gap-3">
              <div className="shrink-0 h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center">
                {s.icon}
              </div>
              <div>
                <div className="font-semibold text-sm text-slate-800">
                  <span className="text-slate-400 mr-1">{i + 1}.</span>{s.title}
                </div>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {hasToken ? (
        <Card className="w-full max-w-sm p-6 rounded-3xl shadow-sm flex flex-col items-center mb-6">
          <div className="flex items-center gap-2 mb-4">
            <QrCode className="h-5 w-5 text-emerald-600" />
            <span className="font-semibold text-slate-800">QR de configuración</span>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-inner">
            <QRCodeSVG value={token} size={200} />
          </div>
          <p className="text-xs text-slate-500 text-center mt-3 leading-relaxed">
            Escanea este código <strong>desde dentro de la app</strong> NeuroShield Kids.
          </p>
        </Card>
      ) : (
        <Card className="w-full max-w-sm p-6 rounded-3xl shadow-sm flex flex-col items-center mb-6 border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-700 text-center">
            Enlace de instalación incompleto. Pide al padre/madre que genere el QR desde el panel.
          </p>
        </Card>
      )}

      <div className="flex items-center gap-2 text-xs text-slate-400 mt-2">
        <Shield className="h-4 w-4" />
        <span>Solo datos de uso de apps. Sin mensajes ni contenido privado.</span>
      </div>

      <div className="w-full max-w-sm mt-6 p-4 rounded-2xl bg-slate-100 text-xs text-slate-500 text-center leading-relaxed">
        <CheckCircle2 className="inline h-4 w-4 text-emerald-500 mr-1" />
        NeuroShield Kids no lee mensajes, fotos ni datos personales.
      </div>
    </div>
  );
}
