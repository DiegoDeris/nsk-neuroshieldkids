import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Shield, FileText, LogOut, Download } from "lucide-react";
import { useSubscription } from "@/hooks/use-subscription";

export default function Account() {
  const { user, signOut } = useAuth();
  const { plan } = useSubscription();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("delete-account", {
        body: {}
      });
      if (res.error) throw res.error;
      toast.success("Cuenta eliminada. Todos tus datos han sido borrados.");
      await signOut();
      navigate("/");
    } catch (e: any) {
      toast.error(e?.message ?? "Error al eliminar la cuenta");
    } finally {
      setDeleting(false);
    }
  };

  const handleExportData = async () => {
    setExporting(true);
    try {
      const [childrenRes, alertsRes, metricsRes] = await Promise.all([
        supabase.from("children").select("*"),
        supabase.from("alerts").select("*").order("created_at", { ascending: false }).limit(500),
        supabase.from("usage_metrics").select("*").order("metric_date", { ascending: false }).limit(1000),
      ]);

      const exportData = {
        exported_at: new Date().toISOString(),
        user_email: user?.email,
        children: childrenRes.data ?? [],
        alerts: alertsRes.data ?? [],
        usage_metrics: metricsRes.data ?? [],
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nsk-datos-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Datos exportados correctamente");
    } catch (e: any) {
      toast.error("Error al exportar datos");
    } finally {
      setExporting(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6 p-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Mi cuenta</h1>
          <p className="text-slate-500 text-sm mt-1">{user?.email}</p>
        </div>

        {/* Información de la cuenta */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" /> Plan actual
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600">
              Plan <strong className="capitalize">{plan}</strong>.{" "}
              {plan !== "premium" && (
                <Link to="/pricing" className="text-blue-600 underline">Actualizar plan</Link>
              )}
            </p>
          </CardContent>
        </Card>

        {/* Privacidad y datos */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" /> Privacidad y datos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600">
              Tienes derecho a acceder, corregir, exportar y eliminar todos tus datos personales y los de
              tus hijos en cualquier momento.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="outline" size="sm" onClick={handleExportData} disabled={exporting}>
                <Download className="h-4 w-4 mr-2" />
                {exporting ? "Exportando..." : "Exportar mis datos (JSON)"}
              </Button>
              <Link to="/privacy">
                <Button variant="ghost" size="sm">
                  <FileText className="h-4 w-4 mr-2" />
                  Ver política de privacidad
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Cerrar sesión */}
        <Card>
          <CardContent className="pt-6">
            <Button variant="outline" className="w-full" onClick={() => { signOut(); navigate("/"); }}>
              <LogOut className="h-4 w-4 mr-2" /> Cerrar sesión
            </Button>
          </CardContent>
        </Card>

        {/* Eliminar cuenta */}
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="text-base text-red-600 flex items-center gap-2">
              <Trash2 className="h-4 w-4" /> Zona de peligro
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600">
              Eliminar tu cuenta borrará permanentemente todos tus datos, los perfiles de tus hijos,
              el historial de uso, las alertas y cancelará tu suscripción. Esta acción es irreversible.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={deleting}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  {deleting ? "Eliminando..." : "Eliminar cuenta y todos mis datos"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Eliminar cuenta permanentemente?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta acción es <strong>irreversible</strong>. Se borrarán tu cuenta, los perfiles de tus hijos,
                    todo el historial de uso, las alertas y la suscripción activa. No podremos recuperar estos datos.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteAccount}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Sí, eliminar todo
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
