import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Loader2, Send, AlertCircle, Smartphone } from "lucide-react";

const INGEST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest-usage`;

type Status = "idle" | "sending" | "ok" | "error";

export default function Connect() {
  const [params] = useSearchParams();
  const token = params.get("t") ?? params.get("token") ?? "";
  const childName = params.get("n") ?? params.get("child") ?? "";
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  const send = async (appName = "ConnectionTest", seconds = 30) => {
    if (!token) {
      setStatus("error");
      setMessage("Token no válido. Pide a tu adulto que regenere el QR.");
      return;
    }
    setStatus("sending");
    try {
      const res = await fetch(INGEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          events: [
            {
              app_name: appName,
              duration_seconds: seconds,
              event_type: "app_usage",
              occurred_at: new Date().toISOString(),
            },
          ],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error ?? `HTTP ${res.status}`);
      setStatus("ok");
      setMessage("¡Conectado! Ya puedes cerrar esta pestaña.");
    } catch (e: any) {
      setStatus("error");
      setMessage(e?.message ?? "No se pudo conectar.");
    }
  };

  useEffect(() => {
    if (token) send("ConnectionTest", 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 text-center space-y-6">
        <div className="flex justify-center">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Smartphone className="h-8 w-8 text-primary" />
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-bold">
            {childName ? `Conectar dispositivo de ${childName}` : "Conectar dispositivo"}
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Estamos enviando una señal de prueba para enlazar este móvil con la cuenta de tu familia.
          </p>
        </div>

        <div className="rounded-xl border p-4 bg-muted/30">
          {status === "sending" && (
            <div className="flex items-center justify-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Enviando señal…
            </div>
          )}
          {status === "ok" && (
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2 text-green-600 font-medium">
                <Check className="h-5 w-5" /> Conectado correctamente
              </div>
              <p className="text-xs text-muted-foreground">{message}</p>
            </div>
          )}
          {status === "error" && (
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2 text-destructive font-medium">
                <AlertCircle className="h-5 w-5" /> Error
              </div>
              <p className="text-xs text-muted-foreground">{message}</p>
            </div>
          )}
          {status === "idle" && !token && (
            <p className="text-xs text-destructive">Falta el token en el enlace.</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Button onClick={() => send("ConnectionTest", 30)} disabled={status === "sending" || !token}>
            <Send className="h-4 w-4 mr-2" />
            {status === "ok" ? "Enviar otra señal" : "Reintentar"}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Solo se envían metadatos de uso. Sin cuentas, sin spyware.
          </p>
        </div>
      </Card>
    </div>
  );
}