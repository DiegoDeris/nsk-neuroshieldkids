import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Apple, Smartphone, Upload, Copy, Check, RefreshCw, Zap, QrCode, Send, Wifi, ChevronRight, ChevronLeft, FileText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  child: { id: string; name: string; ingest_token: string | null; last_ingest_at: string | null };
  onChange: () => void;
}

const PROJECT_URL = import.meta.env.VITE_SUPABASE_URL;
const INGEST_URL = `${PROJECT_URL}/functions/v1/ingest-usage`;

type Platform = "ios" | "android" | "csv";

export const ConnectWizard = ({ child, onChange }: Props) => {
  const { t } = useTranslation();
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [step, setStep] = useState(0);
  const [copied, setCopied] = useState("");
  const [uploading, setUploading] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const initialSync = useRef<string | null>(child.last_ingest_at);

  const token = child.ingest_token ?? "";

  // Detect new ingest while waiting
  useEffect(() => {
    if (!waiting) return;
    if (child.last_ingest_at && child.last_ingest_at !== initialSync.current) {
      toast.success(t("wizard.firstPing"));
      setWaiting(false);
      setStep(s => s + 1);
    }
  }, [child.last_ingest_at, waiting, t]);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 1500);
    toast.success(t("common.copied"));
  };

  const rotateToken = async () => {
    if (!confirm(t("wizard.rotateConfirm"))) return;
    const newToken = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, "0")).join("");
    const { error } = await supabase.from("children").update({ ingest_token: newToken }).eq("id", child.id);
    if (error) return toast.error(error.message);
    toast.success(t("wizard.rotated"));
    onChange();
  };

  const sendTest = async () => {
    try {
      const res = await fetch(INGEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, events: [{ app_name: "TestApp", duration_seconds: 60, event_type: "app_usage" }] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "error");
      toast.success(t("wizard.testOk"));
      onChange();
    } catch (e: any) { toast.error(`❌ ${e.message}`); }
  };

  const onFile = async (file: File) => {
    if (file.size > 2_000_000) return toast.error("Max 2MB");
    setUploading(true);
    try {
      const csv = await file.text();
      const { data, error } = await supabase.functions.invoke("import-csv", { body: { child_id: child.id, csv } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(t("wizard.csvOk", { n: (data as any).ingested, d: (data as any).days.length }));
      onChange();
    } catch (e: any) { toast.error(e.message ?? "Error"); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const qrPayload = JSON.stringify({ url: INGEST_URL, token, child: child.name });
  const isLive = child.last_ingest_at && Date.now() - new Date(child.last_ingest_at).getTime() < 5 * 60 * 1000;

  // ----- Reset wizard ------
  const reset = () => { setPlatform(null); setStep(0); setWaiting(false); initialSync.current = child.last_ingest_at; };

  // ----- STEP 0: choose platform -----
  if (!platform) {
    return (
      <Card className="p-6">
        <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
          <div>
            <h3 className="font-semibold flex items-center gap-2 text-lg">
              <Zap className="h-5 w-5 text-primary" /> {t("wizard.title", { name: child.name })}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">{t("wizard.subtitle")}</p>
          </div>
          {isLive ? (
            <Badge className="gap-1"><span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" /> {t("wizard.connected")}</Badge>
          ) : child.last_ingest_at ? (
            <Badge variant="secondary" className="gap-1"><Wifi className="h-3 w-3" /> {t("wizard.lastSeen")}: {new Date(child.last_ingest_at).toLocaleString()}</Badge>
          ) : (
            <Badge variant="outline">{t("wizard.notConnected")}</Badge>
          )}
        </div>

        <p className="text-sm font-medium mb-3">{t("wizard.choosePlatform")}</p>
        <div className="grid sm:grid-cols-3 gap-3">
          <button onClick={() => { setPlatform("ios"); setStep(0); initialSync.current = child.last_ingest_at; }}
            className="border rounded-xl p-4 text-left hover:border-primary hover:shadow-soft transition-smooth group">
            <Apple className="h-8 w-8 mb-2 text-primary" />
            <div className="font-semibold">iPhone / iPad</div>
            <div className="text-xs text-muted-foreground mt-1">{t("wizard.iosDesc")}</div>
            <div className="mt-3 text-xs text-primary flex items-center gap-1">{t("wizard.start")} <ChevronRight className="h-3 w-3 group-hover:translate-x-1 transition-transform" /></div>
          </button>
          <button onClick={() => { setPlatform("android"); setStep(0); initialSync.current = child.last_ingest_at; }}
            className="border rounded-xl p-4 text-left hover:border-primary hover:shadow-soft transition-smooth group">
            <Smartphone className="h-8 w-8 mb-2 text-primary" />
            <div className="font-semibold">Android</div>
            <div className="text-xs text-muted-foreground mt-1">{t("wizard.androidDesc")}</div>
            <div className="mt-3 text-xs text-primary flex items-center gap-1">{t("wizard.start")} <ChevronRight className="h-3 w-3 group-hover:translate-x-1 transition-transform" /></div>
          </button>
          <button onClick={() => { setPlatform("csv"); setStep(0); }}
            className="border rounded-xl p-4 text-left hover:border-primary hover:shadow-soft transition-smooth group">
            <FileText className="h-8 w-8 mb-2 text-primary" />
            <div className="font-semibold">{t("wizard.csvTitle")}</div>
            <div className="text-xs text-muted-foreground mt-1">{t("wizard.csvDesc")}</div>
            <div className="mt-3 text-xs text-primary flex items-center gap-1">{t("wizard.start")} <ChevronRight className="h-3 w-3 group-hover:translate-x-1 transition-transform" /></div>
          </button>
        </div>

        <details className="mt-4 text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t("wizard.advanced")}</summary>
          <div className="mt-3 p-3 rounded-lg bg-muted/50 space-y-2">
            <div className="flex gap-2">
              <Input readOnly value={INGEST_URL} className="font-mono text-xs" />
              <Button size="icon" variant="outline" onClick={() => copy(INGEST_URL, "url")}>
                {copied === "url" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex gap-2">
              <Input readOnly value={token} className="font-mono text-xs" />
              <Button size="icon" variant="outline" onClick={() => copy(token, "tok")}>
                {copied === "tok" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Button size="icon" variant="outline" onClick={rotateToken} title={t("wizard.rotate")}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </details>
      </Card>
    );
  }

  // ----- CSV flow -----
  if (platform === "csv") {
    return (
      <Card className="p-6 space-y-4">
        <WizardHeader onBack={reset} title={t("wizard.csvTitle")} />
        <div onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
          className="border-2 border-dashed rounded-xl p-10 text-center hover:border-primary transition-smooth cursor-pointer"
          onClick={() => fileRef.current?.click()}>
          <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium">{t("wizard.csvDrop")}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("wizard.csvHint")}</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        </div>
        {uploading && <p className="text-sm text-center text-muted-foreground">{t("common.loading")}</p>}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium">{t("wizard.csvFormat")}</summary>
          <pre className="bg-muted p-3 rounded-lg mt-2 overflow-x-auto">{`date,app,minutes
2026-04-30,TikTok,45
2026-04-30,YouTube,30`}</pre>
        </details>
      </Card>
    );
  }

  // ----- iOS / Android guided flow -----
  const iosSteps = [
    { title: t("wizard.ios.s1Title"), body: t("wizard.ios.s1Body") },
    { title: t("wizard.ios.s2Title"), body: t("wizard.ios.s2Body") },
    { title: t("wizard.ios.s3Title"), body: t("wizard.ios.s3Body") },
    { title: t("wizard.ios.s4Title"), body: t("wizard.ios.s4Body") },
  ];
  const androidSteps = [
    { title: t("wizard.and.s1Title"), body: t("wizard.and.s1Body") },
    { title: t("wizard.and.s2Title"), body: t("wizard.and.s2Body") },
    { title: t("wizard.and.s3Title"), body: t("wizard.and.s3Body") },
    { title: t("wizard.and.s4Title"), body: t("wizard.and.s4Body") },
  ];
  const steps = platform === "ios" ? iosSteps : androidSteps;
  const isWaitStep = step === steps.length - 1;
  const current = steps[step] ?? steps[steps.length - 1];

  return (
    <Card className="p-6 space-y-5">
      <WizardHeader onBack={reset} title={platform === "ios" ? "iPhone / iPad" : "Android"} />

      {/* Progress */}
      <div className="flex items-center gap-2">
        {steps.map((_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i <= step ? "bg-primary" : "bg-muted"}`} />
        ))}
        <span className="text-xs text-muted-foreground ml-2 shrink-0">{step + 1}/{steps.length}</span>
      </div>

      <div>
        <h4 className="font-semibold text-lg flex items-center gap-2">
          <span className="bg-primary/10 text-primary rounded-full h-7 w-7 inline-flex items-center justify-center text-sm font-bold">{step + 1}</span>
          {current.title}
        </h4>
        <p className="text-sm text-muted-foreground mt-2 whitespace-pre-line">{current.body}</p>
      </div>

      {/* Step-specific content */}
      {step === 1 && (
        <div className="grid md:grid-cols-[auto_1fr] gap-4 items-center bg-muted/40 rounded-xl p-4">
          <div className="bg-white p-3 rounded-lg mx-auto">
            <QRCodeSVG value={qrPayload} size={140} />
          </div>
          <div className="space-y-2 text-sm">
            <div className="font-medium flex items-center gap-1"><QrCode className="h-4 w-4" /> {t("wizard.qrTitle")}</div>
            <p className="text-muted-foreground text-xs">{t("wizard.qrHelp")}</p>
            <div className="space-y-1">
              <label className="text-xs font-medium">URL</label>
              <div className="flex gap-1">
                <Input readOnly value={INGEST_URL} className="font-mono text-xs h-8" />
                <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => copy(INGEST_URL, "url2")}>
                  {copied === "url2" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Token</label>
              <div className="flex gap-1">
                <Input readOnly value={token} className="font-mono text-xs h-8" />
                <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => copy(token, "tok2")}>
                  {copied === "tok2" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="bg-muted/40 rounded-xl p-4 space-y-2">
          <div className="text-xs font-medium">{t("wizard.bodyJson")}</div>
          <pre className="bg-background p-3 rounded text-xs overflow-x-auto font-mono border">{`{
  "token": "${token}",
  "events": [
    { "app_name": "TikTok", "duration_seconds": 1800 }
  ]
}`}</pre>
          <Button size="sm" variant="outline" onClick={() => copy(`{"token":"${token}","events":[{"app_name":"TikTok","duration_seconds":1800}]}`, "json")}>
            {copied === "json" ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
            {t("wizard.copyJson")}
          </Button>
        </div>
      )}

      {isWaitStep && (
        <div className={`rounded-xl p-5 text-center border-2 transition-all ${isLive ? "border-green-500 bg-green-500/5" : waiting ? "border-primary bg-primary/5 animate-pulse" : "border-dashed"}`}>
          {isLive ? (
            <>
              <div className="text-4xl mb-2">🎉</div>
              <p className="font-semibold text-green-600">{t("wizard.successTitle")}</p>
              <p className="text-sm text-muted-foreground mt-1">{t("wizard.successBody")}</p>
            </>
          ) : waiting ? (
            <>
              <div className="inline-flex h-10 w-10 rounded-full border-4 border-primary border-t-transparent animate-spin mb-3" />
              <p className="font-medium">{t("wizard.waitingTitle")}</p>
              <p className="text-sm text-muted-foreground mt-1">{t("wizard.waitingBody")}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setWaiting(false)}>{t("common.cancel")}</Button>
            </>
          ) : (
            <>
              <Sparkles className="h-8 w-8 mx-auto text-primary mb-2" />
              <p className="font-medium mb-3">{t("wizard.readyTitle")}</p>
              <div className="flex gap-2 justify-center flex-wrap">
                <Button onClick={sendTest} variant="outline"><Send className="h-3 w-3 mr-1" /> {t("wizard.sendTest")}</Button>
                <Button onClick={() => { initialSync.current = child.last_ingest_at; setWaiting(true); }}>
                  <Wifi className="h-3 w-3 mr-1" /> {t("wizard.waitFirst")}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Nav */}
      <div className="flex justify-between pt-2">
        <Button variant="ghost" size="sm" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}>
          <ChevronLeft className="h-4 w-4 mr-1" /> {t("wizard.prev")}
        </Button>
        {!isWaitStep ? (
          <Button size="sm" onClick={() => setStep(s => s + 1)}>
            {t("wizard.next")} <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={reset}>{t("wizard.done")}</Button>
        )}
      </div>
    </Card>
  );
};

const WizardHeader = ({ onBack, title }: { onBack: () => void; title: string }) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ChevronLeft className="h-4 w-4 mr-1" /> {t("wizard.changePlatform")}
      </Button>
      <Badge variant="secondary">{title}</Badge>
    </div>
  );
};
