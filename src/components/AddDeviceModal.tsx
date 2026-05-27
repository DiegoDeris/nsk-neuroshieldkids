import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, CheckCircle2, RefreshCw, Smartphone, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const GENERATE_FN = `${SUPABASE_URL}/functions/v1/generate-install-token`;

type Props = {
  childId: string;
  childName: string;
  childAvatar: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConnected?: () => void;
};

type Phase = "loading" | "ready" | "connected" | "error";

export function AddDeviceModal({ childId, childName, childAvatar, open, onOpenChange, onConnected }: Props) {
  const { session } = useAuth();
  const [phase, setPhase] = useState<Phase>("loading");
  const [installUrl, setInstallUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const generate = async () => {
    setPhase("loading");
    setErrMsg("");
    try {
      const res = await fetch(GENERATE_FN, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ child_id: childId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error generando QR");
      setInstallUrl(data.url);
      setExpiresAt(data.expires_at);
      setPhase("ready");
    } catch (e: any) {
      setErrMsg(e.message);
      setPhase("error");
    }
  };

  // Generate on open
  useEffect(() => {
    if (open && session) generate();
    if (!open) setPhase("loading");
  }, [open, childId, session]);

  // Real-time: watch children.last_ingest_at for this child
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

  const hoursLeft = expiresAt
    ? Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 3_600_000))
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[340px] rounded-3xl p-0 overflow-hidden border-0 shadow-2xl">

        {/* Top gradient header */}
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
              <Button variant="outline" size="sm" onClick={generate} className="gap-2 rounded-xl">
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
                  Abrirá la descarga automáticamente
                </p>
              </div>

              {/* QR */}
              <div className="bg-white p-4 rounded-2xl shadow-inner border border-slate-100">
                <QRCodeSVG value={installUrl} size={210} level="M" />
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-400 w-full">
                <Smartphone className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">Esperando vinculación…</span>
                {hoursLeft !== null && (
                  <span className="text-slate-300">caduca {hoursLeft}h</span>
                )}
              </div>

              <button
                onClick={generate}
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
