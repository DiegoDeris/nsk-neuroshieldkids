import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { z } from "zod";

const EMOJIS = ["🧒","👧","👦","🧑","👶","🦊","🐼","🦁","🐻","🦄"];

const Children = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", age: 10, avatar_emoji: "🧒" });

  const schema = z.object({
    name: z.string().trim().min(1, t("children.nameRequired")).max(40),
    age: z.coerce.number().int().min(3).max(18),
    avatar_emoji: z.string().min(1).max(4),
  });

  const load = async () => {
    const { data } = await supabase.from("children").select("*").order("created_at");
    setList(data ?? []);
  };
  useEffect(() => { if (user) load(); }, [user]);

  const create = async () => {
    const parsed = schema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    const { error } = await supabase.from("children").insert([{
      name: parsed.data.name, age: parsed.data.age,
      avatar_emoji: parsed.data.avatar_emoji, parent_id: user!.id,
    }]);
    if (error) return toast.error(error.message);
    toast.success(t("children.createdToast", { name: form.name }));
    setOpen(false);
    setForm({ name: "", age: 10, avatar_emoji: "🧒" });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm(t("children.confirmDelete"))) return;
    const { error } = await supabase.from("children").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("children.deletedToast"));
    load();
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{t("children.title")}</h1>
            <p className="text-muted-foreground">{t("children.subtitle")}</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> {t("children.add")}</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{t("children.newChild")}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{t("children.name")}</Label>
                  <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={t("children.namePlaceholder")} />
                </div>
                <div className="space-y-2">
                  <Label>{t("children.age")}</Label>
                  <Input type="number" min={3} max={18} value={form.age}
                    onChange={e => setForm({ ...form, age: Number(e.target.value) })} />
                </div>
                <div className="space-y-2">
                  <Label>{t("children.avatar")}</Label>
                  <div className="flex flex-wrap gap-2">
                    {EMOJIS.map(e => (
                      <button key={e} type="button" onClick={() => setForm({ ...form, avatar_emoji: e })}
                        className={`text-2xl p-2 rounded-lg border transition-smooth ${form.avatar_emoji === e ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}>{e}</button>
                    ))}
                  </div>
                </div>
                <Button className="w-full" onClick={create}>{t("common.create")}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {list.map(c => (
            <Card key={c.id} className="p-5 flex items-center justify-between hover:shadow-soft transition-smooth">
              <Link to={`/child/${c.id}`} className="flex items-center gap-4 flex-1">
                <div className="text-4xl">{c.avatar_emoji}</div>
                <div>
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-sm text-muted-foreground">{t("dashboard.yearsOld", { age: c.age })}</div>
                </div>
              </Link>
              <Button size="icon" variant="ghost" onClick={() => remove(c.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </Card>
          ))}
          {list.length === 0 && (
            <Card className="p-10 text-center md:col-span-2 border-dashed">
              <p className="text-muted-foreground">{t("children.empty")}</p>
            </Card>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default Children;
