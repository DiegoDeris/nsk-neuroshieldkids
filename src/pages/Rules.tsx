import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Shield, Clock, Ban, Moon, Zap } from "lucide-react";
import { toast } from "sonner";

type Rule = {
  id: string; name: string; rule_type: string; config: any; severity: string;
  enabled: boolean; child_id: string | null; cooldown_minutes: number;
  last_triggered_at: string | null;
};

const RULE_TYPES = [
  { value: "forbidden_app", label: "Apps prohibidas", icon: Ban, desc: "Alerta si se abre una app del listado" },
  { value: "daily_time_limit", label: "Límite diario total", icon: Clock, desc: "Alerta al superar X min de pantalla al día" },
  { value: "app_time_limit", label: "Límite por app", icon: Shield, desc: "Alerta al superar X min en una app concreta" },
  { value: "restricted_hours", label: "Horario restringido", icon: Moon, desc: "Alerta si hay actividad en franja prohibida" },
  { value: "session_burst", label: "Uso compulsivo", icon: Zap, desc: "Alerta si abre el móvil X veces en pocos min" },
];

const Rules = () => {
  const { user } = useAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [children, setChildren] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    name: "", rule_type: "daily_time_limit", child_id: "all", severity: "moderate",
    cooldown_minutes: 60,
    minutes: 120, app: "", apps: "", start_hour: 22, end_hour: 7,
    window_minutes: 10, max_sessions: 8,
  });

  const load = async () => {
    const [{ data: r }, { data: c }] = await Promise.all([
      supabase.from("rules").select("*").order("created_at", { ascending: false }),
      supabase.from("children").select("id,name,avatar_emoji"),
    ]);
    setRules((r as any) ?? []);
    setChildren(c ?? []);
  };
  useEffect(() => { load(); }, []);

  const buildConfig = () => {
    switch (form.rule_type) {
      case "forbidden_app": return { apps: form.apps.split(",").map((s: string) => s.trim()).filter(Boolean) };
      case "daily_time_limit": return { minutes: Number(form.minutes) };
      case "app_time_limit": return { app: form.app, minutes: Number(form.minutes) };
      case "restricted_hours": return { start_hour: Number(form.start_hour), end_hour: Number(form.end_hour) };
      case "session_burst": return { window_minutes: Number(form.window_minutes), max_sessions: Number(form.max_sessions) };
      default: return {};
    }
  };

  const create = async () => {
    if (!form.name.trim()) return toast.error("Pon un nombre a la regla");
    const { error } = await supabase.from("rules").insert([{
      parent_id: user!.id,
      child_id: form.child_id === "all" ? null : form.child_id,
      name: form.name.trim().slice(0, 80),
      rule_type: form.rule_type,
      config: buildConfig(),
      severity: form.severity,
      cooldown_minutes: Math.max(5, Math.min(1440, Number(form.cooldown_minutes))),
    }]);
    if (error) return toast.error(error.message);
    toast.success("Regla creada");
    setOpen(false);
    load();
  };

  const toggle = async (r: Rule) => {
    await supabase.from("rules").update({ enabled: !r.enabled }).eq("id", r.id);
    load();
  };
  const remove = async (id: string) => {
    if (!confirm("¿Borrar regla?")) return;
    await supabase.from("rules").delete().eq("id", id);
    load();
  };

  const sevColor: any = { critical: "destructive", moderate: "default", preventive: "secondary" };
  const renderConfig = (r: Rule) => {
    const c = r.config || {};
    switch (r.rule_type) {
      case "forbidden_app": return `Apps: ${(c.apps || []).join(", ")}`;
      case "daily_time_limit": return `Máx ${c.minutes} min/día`;
      case "app_time_limit": return `${c.app}: máx ${c.minutes} min/día`;
      case "restricted_hours": return `Bloqueado ${c.start_hour}h–${c.end_hour}h`;
      case "session_burst": return `>${c.max_sessions} aperturas en ${c.window_minutes} min`;
      default: return "";
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">Reglas de monitorización</h1>
          <p className="text-muted-foreground">Alertas automáticas en tiempo casi real cuando se cumplen condiciones.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> Nueva regla</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Nueva regla</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Nombre</Label>
                <Input maxLength={80} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ej: TikTok prohibido entre semana" /></div>
              <div><Label>Tipo</Label>
                <Select value={form.rule_type} onValueChange={v => setForm({ ...form, rule_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{RULE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">{RULE_TYPES.find(t => t.value === form.rule_type)?.desc}</p>
              </div>
              <div><Label>Aplicar a</Label>
                <Select value={form.child_id} onValueChange={v => setForm({ ...form, child_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los hijos</SelectItem>
                    {children.map(c => <SelectItem key={c.id} value={c.id}>{c.avatar_emoji} {c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {form.rule_type === "forbidden_app" && (
                <div><Label>Apps prohibidas (separadas por coma)</Label>
                  <Input value={form.apps} onChange={e => setForm({ ...form, apps: e.target.value })} placeholder="TikTok, Snapchat, OnlyFans" /></div>
              )}
              {form.rule_type === "daily_time_limit" && (
                <div><Label>Minutos máximos al día</Label>
                  <Input type="number" min={1} max={1440} value={form.minutes} onChange={e => setForm({ ...form, minutes: e.target.value })} /></div>
              )}
              {form.rule_type === "app_time_limit" && (
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>App</Label><Input value={form.app} onChange={e => setForm({ ...form, app: e.target.value })} placeholder="Instagram" /></div>
                  <div><Label>Min/día</Label><Input type="number" min={1} max={1440} value={form.minutes} onChange={e => setForm({ ...form, minutes: e.target.value })} /></div>
                </div>
              )}
              {form.rule_type === "restricted_hours" && (
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Hora inicio</Label><Input type="number" min={0} max={23} value={form.start_hour} onChange={e => setForm({ ...form, start_hour: e.target.value })} /></div>
                  <div><Label>Hora fin</Label><Input type="number" min={0} max={23} value={form.end_hour} onChange={e => setForm({ ...form, end_hour: e.target.value })} /></div>
                </div>
              )}
              {form.rule_type === "session_burst" && (
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Ventana (min)</Label><Input type="number" min={1} max={120} value={form.window_minutes} onChange={e => setForm({ ...form, window_minutes: e.target.value })} /></div>
                  <div><Label>Aperturas máx</Label><Input type="number" min={2} max={100} value={form.max_sessions} onChange={e => setForm({ ...form, max_sessions: e.target.value })} /></div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div><Label>Severidad</Label>
                  <Select value={form.severity} onValueChange={v => setForm({ ...form, severity: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="preventive">Preventiva</SelectItem>
                      <SelectItem value="moderate">Moderada</SelectItem>
                      <SelectItem value="critical">Crítica</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Cooldown (min)</Label>
                  <Input type="number" min={5} max={1440} value={form.cooldown_minutes} onChange={e => setForm({ ...form, cooldown_minutes: e.target.value })} /></div>
              </div>
              <Button onClick={create} className="w-full">Crear regla</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3">
        {rules.length === 0 && (
          <Card className="p-10 text-center text-muted-foreground">
            <Shield className="h-10 w-10 mx-auto mb-2 text-primary" />
            Aún no tienes reglas. Crea la primera para que el sistema te avise automáticamente.
          </Card>
        )}
        {rules.map(r => {
          const T = RULE_TYPES.find(t => t.value === r.rule_type);
          const Icon = T?.icon ?? Shield;
          const child = children.find(c => c.id === r.child_id);
          return (
            <Card key={r.id} className="p-4 flex items-start gap-4">
              <div className="p-2 rounded-lg bg-primary/10"><Icon className="h-5 w-5 text-primary" /></div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{r.name}</span>
                  <Badge variant={sevColor[r.severity]} className="capitalize text-xs">{r.severity}</Badge>
                  <Badge variant="outline" className="text-xs">{child ? `${child.avatar_emoji} ${child.name}` : "Todos"}</Badge>
                  {r.last_triggered_at && (
                    <span className="text-xs text-muted-foreground">Última alerta: {new Date(r.last_triggered_at).toLocaleString("es")}</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">{T?.label} · {renderConfig(r)} · cooldown {r.cooldown_minutes}min</p>
              </div>
              <Switch checked={r.enabled} onCheckedChange={() => toggle(r)} />
              <Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </Card>
          );
        })}
      </div>
    </AppLayout>
  );
};

export default Rules;
