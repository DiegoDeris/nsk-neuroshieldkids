import { useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Smartphone, Upload, Copy, Check, RefreshCw, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  child: { id: string; name: string; ingest_token: string | null; last_ingest_at: string | null };
  onChange: () => void;
}

const PROJECT_URL = import.meta.env.VITE_SUPABASE_URL;
const INGEST_URL = `${PROJECT_URL}/functions/v1/ingest-usage`;

export const ConnectDevice = ({ child, onChange }: Props) => {
  const [copied, setCopied] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const token = child.ingest_token ?? "";

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 1500);
    toast.success("Copiado");
  };

  const rotateToken = async () => {
    if (!confirm("Esto invalidará el token actual. Tendrás que reconfigurar tus dispositivos. ¿Continuar?")) return;
    const newToken = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, "0")).join("");
    const { error } = await supabase.from("children").update({ ingest_token: newToken }).eq("id", child.id);
    if (error) return toast.error(error.message);
    toast.success("Token regenerado");
    onChange();
  };

  const onFile = async (file: File) => {
    if (file.size > 2_000_000) return toast.error("Máximo 2MB");
    setUploading(true);
    try {
      const csv = await file.text();
      const { data, error } = await supabase.functions.invoke("import-csv", {
        body: { child_id: child.id, csv },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Importados ${(data as any).ingested} eventos en ${(data as any).days.length} días`);
      onChange();
    } catch (e: any) {
      toast.error(e.message ?? "Error importando");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const curlExample = `curl -X POST ${INGEST_URL} \\
  -H "Content-Type: application/json" \\
  -d '{
    "token": "${token}",
    "events": [
      { "app_name": "TikTok", "duration_seconds": 1800, "occurred_at": "${new Date().toISOString()}" }
    ]
  }'`;

  const shortcutJSON = `{
  "token": "${token}",
  "events": [
    { "app_name": "TikTok", "duration_seconds": 1800 }
  ]
}`;

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /> Monitorización automática</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Conecta el dispositivo de {child.name} para recibir métricas en tiempo real.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {child.last_ingest_at ? (
            <Badge variant="secondary" className="gap-1">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              Activo · última sync {new Date(child.last_ingest_at).toLocaleString("es")}
            </Badge>
          ) : (
            <Badge variant="outline">Sin datos automáticos aún</Badge>
          )}
        </div>
      </div>

      <Tabs defaultValue="api" className="w-full">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="api"><Smartphone className="h-4 w-4 mr-1" /> API / Token</TabsTrigger>
          <TabsTrigger value="ios">iOS Shortcut</TabsTrigger>
          <TabsTrigger value="csv"><Upload className="h-4 w-4 mr-1" /> CSV</TabsTrigger>
        </TabsList>

        <TabsContent value="api" className="space-y-3 pt-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Endpoint</label>
            <div className="flex gap-2">
              <Input readOnly value={INGEST_URL} className="font-mono text-xs" />
              <Button size="icon" variant="outline" onClick={() => copy(INGEST_URL, "url")}>
                {copied === "url" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Token único de {child.name} (¡secreto!)</label>
            <div className="flex gap-2">
              <Input readOnly value={token} className="font-mono text-xs" />
              <Button size="icon" variant="outline" onClick={() => copy(token, "tok")}>
                {copied === "tok" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Button size="icon" variant="outline" onClick={rotateToken} title="Regenerar">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Ejemplo cURL</label>
            <div className="relative">
              <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto font-mono">{curlExample}</pre>
              <Button size="icon" variant="ghost" className="absolute top-2 right-2" onClick={() => copy(curlExample, "curl")}>
                {copied === "curl" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Compatible con <strong>Tasker</strong> (Android), <strong>Shortcuts</strong> (iOS), apps companion o cualquier sistema que pueda hacer POST. El cron diario analizará los datos automáticamente cada día a las 08:00.
          </p>
        </TabsContent>

        <TabsContent value="ios" className="space-y-3 pt-4">
          <ol className="text-sm space-y-2 list-decimal list-inside text-muted-foreground">
            <li>Abre <strong>Atajos</strong> en el iPhone del niño/a → crea un nuevo atajo.</li>
            <li>Añade acción <strong>"Obtener tiempo de pantalla"</strong> (iOS 17+).</li>
            <li>Añade acción <strong>"Obtener contenido de URL"</strong>:
              <ul className="ml-6 mt-1 list-disc">
                <li>URL: <code className="text-xs bg-muted px-1 rounded">{INGEST_URL}</code></li>
                <li>Método: <strong>POST</strong></li>
                <li>Cabeceras: <code className="text-xs bg-muted px-1 rounded">Content-Type: application/json</code></li>
                <li>Cuerpo de la solicitud (JSON):</li>
              </ul>
            </li>
          </ol>
          <div className="relative">
            <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto font-mono">{shortcutJSON}</pre>
            <Button size="icon" variant="ghost" className="absolute top-2 right-2" onClick={() => copy(shortcutJSON, "json")}>
              {copied === "json" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            4. Programa el atajo con <strong>Automatización personal → A una hora</strong> (ej: cada noche a las 23:00). Se ejecutará solo y enviará los datos.
          </p>
        </TabsContent>

        <TabsContent value="csv" className="space-y-3 pt-4">
          <div
            onDragOver={e => { e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
            className="border-2 border-dashed rounded-xl p-8 text-center hover:border-primary transition-smooth cursor-pointer"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="font-medium">Arrastra el CSV o haz clic</p>
            <p className="text-xs text-muted-foreground mt-1">Family Link export, Screen Time export, o formato propio</p>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          </div>
          {uploading && <p className="text-sm text-center text-muted-foreground">Procesando…</p>}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium">Formato esperado</summary>
            <pre className="bg-muted p-3 rounded-lg mt-2 overflow-x-auto">{`date,app,minutes
2026-04-30,TikTok,45
2026-04-30,YouTube,30
2026-04-30,WhatsApp,12`}</pre>
            <p className="mt-2">Cabeceras alternativas aceptadas: <code>timestamp</code>, <code>app_name</code>, <code>duration_seconds</code>, <code>duration_minutes</code>.</p>
          </details>
        </TabsContent>
      </Tabs>
    </Card>
  );
};
