import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, CheckCircle2, RefreshCw, Smartphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Props = {
  childId: string;
  childName: string;
  childAvatar: string;
  ingestToken?: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConnected?: () => void;
};

type Phase = "loading" | "ready" | "connected" | "error";

export function AddDeviceModal({ childId, childName, childAvatar, ingestToken: initialToken, open, onOpenChange, onConnected }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [token, setToken] = useState(initialToken ?? "");
  const [errMsg, setErrMsg] = useState("");
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Ensure token exists — auto-generate if missing
  const ensureToken = async () => {
    setPhase("loading");
    setErrMsg("");
    try {
      let tok = token;
      if (!tok || tok.length < 16) {
        tok = Array.from(crypto.getRandomValues(new Uint8Array(24)))
          .map(b => b.toString(16).padStart(2, "0")).join("");
        const { error } = await supabase.from("children").update({ ingest_token: tok }).eq("id", childId);
        if (error) throw error;
        setToken(tok);
      }
      setPhase("ready");
    } catch (e: any) {
      setErrMsg(e.message ?? "Error generando QR");
      setPhase("error");
    }
  };

  useEffect(() => {
    if (open) ensureToken();
    if (!open) setPhase("loading");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, childId]);

  // Real-time: detect first ingest → connected
  useEffect(() => {
    if (!open || phase !== "ready") return;

    channelRef.current = supabase
      .channel(`add-device-${childId}-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "children", filter: `id=eq.${childId}` },
        (payload: any) => {
          if (payload.new?.last_ingest_at !== payload.old?.last_ingest_at) {
            setPhase("connected");
            onConnected?.();
            setTimeout(() => onOpenChange(false), 2500);
          }
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [open, phase, childId]);

  const monitorUrl = token
    ? `${window.location.origin}/monitor?t=${encodeURIComponent(token)}`
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[340px] rounded-3xl p-0 overflow-hidden border-0 shadow-2xl">

        {/* Header */}
        <div className="bg-gradient-to-b from-blue-50 to-white px-6 pt-8 pb-5 text-center">
          <div className="text-5xl mb-3">{childAvatar}</div>
          <h2 className="text-lg font-bold text-slate-800">{childName}</h2>
          <p className="text-sm text-slate-400 mt-0.5">Conectar dispositivo</p>
        </div>

        <div className="px-6 pb-8 flex flex-col items-center gap-4 min-h-[260px]">

          {phase === "loading" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 py-6">
              <Loader2 className="h-9 w-9 animate-spin text-blue-500" />
              <p className="text-sm text-slate-400">Generando QR…</p>
            </div>
          )}

          {phase === "error" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center py-6">
              <p className="text-sm text-red-500">{errMsg}</p>
              <Button variant="outline" size="sm" onClick={ensureToken} className="gap-2 rounded-xl">
                <RefreshCw className="h-4 w-4" /> Reintentar
              </Button>
            </div>
          )}

          {phase === "ready" && (
            <>
              <div className="text-center">
                <p className="text-sm font-medium text-slate-700">
                  Escanea con el móvil de <strong>{childName}</strong>
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  iOS o Android — se abre directo en el navegador
                </p>
              </div>

              <div className="bg-white p-4 rounded-2xl shadow-inner border border-slate-100">
                <QRCodeSVG value={monitorUrl} size={210} level="M" />
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-400 w-full">
                <Smartphone className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">Esperando vinculación…</span>
              </div>

              <button
                onClick={() => { setToken(""); ensureToken(); toast.info("Nuevo QR generado"); }}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                Generar nuevo QR
              </button>
            </>
          )}

          {phase === "connected" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-6">
              <CheckCircle2 className="h-14 w-14 text-emerald-500" />
              <p className="text-lg font-bold text-slate-800">¡Conectado!</p>
              <p className="text-sm text-slate-500">{childName} ya está protegido/a</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
