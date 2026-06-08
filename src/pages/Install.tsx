import { useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { Share, PlusSquare, Shield, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";

const steps = [
  {
    icon: <Share className="h-6 w-6 text-blue-500" />,
    title: "Abre el enlace en el móvil de tu hijo",
    body: "Escanea el QR con la cámara del móvil de tu hijo (Android o iPhone). Se abrirá en el navegador.",
  },
  {
    icon: <PlusSquare className="h-6 w-6 text-violet-500" />,
    title: "Añade a la pantalla de inicio",
    body: 'Pulsa el menú del navegador y elige "Añadir a pantalla de inicio" (o "Instalar app"). Listo — aparece como una app.',
  },
  {
    icon: <Shield className="h-6 w-6 text-emerald-500" />,
    title: "Protección activa",
    body: "Abre NeuroShield desde la pantalla de inicio. Empieza a enviar datos automáticamente al panel de control.",
  },
];

export default function Install() {
  const [params] = useSearchParams();
  const token = params.get("t") ?? "";
  const childName = params.get("n") ?? "tu hijo/a";
  const hasToken = token.length >= 16;

  const monitorUrl = hasToken
    ? `${window.location.origin}/monitor?t=${token}`
    : "";

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center px-4 py-10">
      {/* Header */}
      <div className="flex flex-col items-center mb-8 text-center">
        <div className="h-20 w-20 rounded-3xl bg-blue-600 flex items-center justify-center shadow-lg mb-4">
          <Shield className="h-10 w-10 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-slate-800">NeuroShield Kids</h1>
        <p className="text-slate-500 text-sm mt-1">
          Protección para <strong>{childName}</strong>
        </p>
      </div>

      {/* QR */}
      {hasToken ? (
        <Card className="w-full max-w-sm p-6 rounded-3xl shadow-sm flex flex-col items-center mb-6">
          <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-4">
            Escanea con el móvil de tu hijo
          </p>
          <div className="bg-white p-4 rounded-2xl shadow-inner border border-slate-100">
            <QRCodeSVG value={monitorUrl} size={210} />
          </div>
          <p className="text-xs text-slate-400 text-center mt-4 break-all leading-relaxed">
            {monitorUrl}
          </p>
        </Card>
      ) : (
        <Card className="w-full max-w-sm p-6 rounded-3xl shadow-sm flex flex-col items-center mb-6 border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-700 text-center">
            Enlace incompleto. Genera el QR desde el panel de control.
          </p>
        </Card>
      )}

      {/* Pasos */}
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

      {/* Footer */}
      <div className="w-full max-w-sm p-4 rounded-2xl bg-slate-100 text-xs text-slate-500 text-center leading-relaxed">
        <CheckCircle2 className="inline h-4 w-4 text-emerald-500 mr-1" />
        Sin apps nativas ni instalaciones complejas. Funciona en Android e iPhone.
        No leemos mensajes, fotos ni contenido privado — solo patrones de uso.
      </div>
    </div>
  );
}
