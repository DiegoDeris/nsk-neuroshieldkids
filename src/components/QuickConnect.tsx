import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, Send, Wifi, RefreshCw, QrCode, Zap, Settings2, Upload, Download, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ConnectWizard } from "./ConnectWizard";

interface Props {
  child: { id: string; name: string; ingest_token: string | null; last_ingest_at: string | null };
  onChange: () => void;
}

const PROJECT_URL = import.meta.env.VITE_SUPABASE_URL;
const INGEST_URL = `${PROJECT_URL}/functions/v1/ingest-usage`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export const QuickConnect = ({ child, onChange }: Props) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState("");
  const [guided, setGuided] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const initialSync = useRef<string | null>(child.last_ingest_at);
  const [token, setToken] = useState(child.ingest_token ?? "");

  // Auto-generate token if missing (child created before migration or token was null)
  useEffect(() => {
    if (token) return;
    const newToken = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, "0")).join("");
    supabase.from("children").update({ ingest_token: newToken }).eq("id", child.id).then(({ error }) => {
      if (error) { toast.error("No se pudo generar el token QR"); return; }
      setToken(newToken);
      onChange();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isLive = child.last_ingest_at && Date.now() - new Date(child.last_ingest_at).getTime() < 5 * 60 * 1000;

  useEffect(() => {
    if (!waiting) return;
    if (child.last_ingest_at && child.last_ingest_at !== initialSync.current) {
      toast.success(t("quick.connected"));
      setWaiting(false);
    }
  }, [child.last_ingest_at, waiting, t]);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 1500);
    toast.success(t("common.copied"));
  };

  const sendTest = async () => {
    try {
      const res = await fetch(INGEST_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${ANON_KEY}`,
          "apikey": ANON_KEY,
        },
        body: JSON.stringify({ token, events: [{ app_name: "TestApp", duration_seconds: 60, event_type: "app_usage" }] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "error");
      toast.success(t("quick.testOk"));
      onChange();
    } catch (e: any) { toast.error(`❌ ${e.message}`); }
  };

  const rotate = async () => {
    if (!confirm(t("quick.rotateConfirm"))) return;
    const newToken = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, "0")).join("");
    const { error } = await supabase.from("children").update({ ingest_token: newToken }).eq("id", child.id);
    if (error) return toast.error(error.message);
    setToken(newToken);
    toast.success(t("quick.rotated"));
    onChange();
  };

  const onFile = async (file: File) => {
    if (file.size > 2_000_000) return toast.error("Max 2MB");
    setUploading(true);
    try {
      const csv = await file.text();
      const { data, error } = await supabase.functions.invoke("import-csv", { body: { child_id: child.id, csv } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(t("quick.csvOk", { n: (data as any).ingested }));
      onChange();
    } catch (e: any) { toast.error(e.message ?? "Error"); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const [qrMode, setQrMode] = useState<"install" | "token">("install");
  // install QR → opens /install page (first-time setup with APK download)
  // token QR  → raw token (for already-installed app)
  const installQrPayload = `${window.location.origin}/install?t=${encodeURIComponent(token)}&n=${encodeURIComponent(child.name)}`;
  const qrPayload = qrMode === "install" ? installQrPayload : token;

  if (guided) {
    return (
      <div className="space-y-2">
        <Button size="sm" variant="ghost" onClick={() => setGuided(false)}>← {t("quick.backToQuick")}</Button>
        <ConnectWizard child={child} onChange={onChange} />
      </div>
    );
  }

  return (
    <Card className="p-6 gradient-card">
      <div className="flex items-start justify-between gap-2 flex-wrap mb-4">
        <div>
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" /> {t("quick.title", { name: child.name })}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">{t("quick.subtitle")}</p>
        </div>
        {isLive ? (
          <Badge className="gap-1"><span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" /> {t("quick.live")}</Badge>
        ) : child.last_ingest_at ? (
          <Badge variant="secondary" className="gap-1"><Wifi className="h-3 w-3" /> {t("quick.lastSeen")}: {new Date(child.last_ingest_at).toLocaleString()}</Badge>
        ) : (
          <Badge variant="outline">{t("quick.notConnected")}</Badge>
        )}
      </div>

      <div className="grid md:grid-cols-[auto_1fr] gap-6 items-start">
        {/* QR */}
        <div className="flex flex-col items-center gap-2">
          <div className="bg-white p-4 rounded-2xl shadow-soft mx-auto">
            <QRCodeSVG value={qrPayload} size={180} />
          </div>
          <div className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1">
            {qrMode === "install"
              ? <><Download className="h-3 w-3" /> Escanear para instalar la app</>
              : <><QrCode className="h-3 w-3" /> Escanear desde dentro de la app</>
            }
          </div>
          <div className="flex gap-1">
            <Button
              size="sm" variant={qrMode === "install" ? "default" : "outline"}
              className="h-7 text-xs px-3"
              onClick={() => setQrMode("install")}
            >
              <Smartphone className="h-3 w-3 mr-1" /> Instalar
            </Button>
            <Button
              size="sm" variant={qrMode === "token" ? "default" : "outline"}
              className="h-7 text-xs px-3"
              onClick={() => setQrMode("token")}
            >
              <QrCode className="h-3 w-3 mr-1" /> Configurar
            </Button>
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-4">
          <Step n={1} title={t("quick.step1Title")} body={t("quick.step1Body")} />
          <Step n={2} title={t("quick.step2Title")} body={t("quick.step2Body")} />
          <Step n={3} title={t("quick.step3Title")} body={t("quick.step3Body")} />

          <div className="flex gap-2 flex-wrap pt-2">
            <Button onClick={sendTest} variant="outline" size="sm">
              <Send className="h-3 w-3 mr-1" /> {t("quick.sendTest")}
            </Button>
            {!waiting ? (
              <Button onClick={() => { initialSync.current = child.last_ingest_at; setWaiting(true); }} size="sm">
                <Wifi className="h-3 w-3 mr-1" /> {t("quick.listen")}
              </Button>
            ) : (
              <Button variant="secondary" size="sm" disabled>
                <span className="inline-block h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin mr-2" />
                {t("quick.listening")}
              </Button>
            )}
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload className="h-3 w-3 mr-1" /> {uploading ? t("common.loading") : t("quick.csv")}
            </Button>
          </div>
        </div>
      </div>

      {/* Compact url+token row */}
      <div className="mt-5 grid sm:grid-cols-2 gap-2">
        <div className="flex gap-1">
          <Input readOnly value={INGEST_URL} className="font-mono text-xs h-9" />
          <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => copy(INGEST_URL, "url")}>
            {copied === "url" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </Button>
        </div>
        <div className="flex gap-1">
          <Input readOnly value={token} className="font-mono text-xs h-9" />
          <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => copy(token, "tok")}>
            {copied === "tok" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </Button>
          <Button size="icon" variant="outline" className="h-9 w-9" onClick={rotate} title={t("quick.rotate")}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="link" size="sm" onClick={() => setGuided(true)}>
          <Settings2 className="h-3 w-3 mr-1" /> {t("quick.guided")}
        </Button>
      </div>
    </Card>
  );
};

const Step = ({ n, title, body }: { n: number; title: string; body: string }) => (
  <div className="flex gap-3">
    <div className="bg-primary/10 text-primary rounded-full h-7 w-7 inline-flex items-center justify-center text-sm font-bold shrink-0">{n}</div>
    <div>
      <div className="font-medium text-sm">{title}</div>
      <p className="text-xs text-muted-foreground mt-0.5">{body}</p>
    </div>
  </div>
);
