import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";
import { LanguageToggle } from "@/components/LanguageToggle";
import { toast } from "sonner";
import { z } from "zod";

const Auth = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">(params.get("mode") === "signup" ? "signup" : "signin");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", full_name: "" });

  const translateAuthError = (message?: string) => {
    const normalized = (message ?? "").toLowerCase();
    if (normalized.includes("weak") || normalized.includes("easy to guess") || normalized.includes("password is known") || normalized.includes("pwned")) return t("auth.passwordMin");
    if (normalized.includes("already registered") || normalized.includes("already exists")) return t("auth.emailAlreadyRegistered");
    if (normalized.includes("invalid login") || normalized.includes("invalid credentials")) return t("auth.invalidCredentials");
    if (normalized.includes("email not confirmed")) return t("auth.emailNotConfirmed");
    return message ?? t("auth.errorAuth");
  };

  const baseSchema = {
    email: z.string().trim().email(t("auth.invalidEmail")).max(255),
    password: z.string().min(8, t("auth.passwordMin")).max(72),
  };
  const schema = mode === "signup"
    ? z.object({
        email: baseSchema.email,
        password: baseSchema.password,
        full_name: z.string().trim().max(80).optional(),
      })
    : z.object(baseSchema);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(mode === "signup" ? form : { email: form.email, password: form.password });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    const clean = parsed.data as { email: string; password: string; full_name?: string };
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: clean.email, password: clean.password,
          options: { emailRedirectTo: `${window.location.origin}/dashboard`, data: { full_name: clean.full_name || clean.email.split("@")[0] } },
        });
        if (error) throw error;
        toast.success(t("auth.createdToast"));
        navigate("/dashboard");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: clean.email, password: clean.password });
        if (error) throw error;
        toast.success(t("auth.welcomeBack"));
        navigate("/dashboard");
      }
    } catch (err: any) {
      toast.error(translateAuthError(err.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex gradient-hero items-center justify-center p-12 text-primary-foreground">
        <div className="max-w-md space-y-4">
          <Logo size={48} />
          <h2 className="text-4xl font-bold">{t("auth.heroTitle")}</h2>
          <p className="opacity-90">{t("auth.heroText")}</p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex items-center justify-between">
            <div className="lg:hidden"><Logo /></div>
            <div className="ml-auto"><LanguageToggle compact /></div>
          </div>
          <div>
            <h1 className="text-3xl font-bold">{mode === "signup" ? t("auth.signup") : t("auth.signin")}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {mode === "signup" ? t("auth.signupSubtitle") : t("auth.signinSubtitle")}
            </p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="full_name">{t("auth.yourName")}</Label>
                <Input id="full_name" autoComplete="name" value={form.full_name}
                  onChange={e => setForm({ ...form, full_name: e.target.value })} placeholder={t("auth.namePlaceholder")} />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input id="email" type="email" required autoComplete="email" value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@email.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("auth.password")}</Label>
              <Input id="password" type="password" required minLength={8} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })} placeholder={t("auth.passwordHint")} />
            </div>
            <Button type="submit" className="w-full shadow-glow" disabled={loading}>
              {loading ? t("auth.processing") : mode === "signup" ? t("auth.signup") : t("auth.signin")}
            </Button>
          </form>
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">{t("auth.orContinue")}</span>
            </div>
          </div>
          <Button type="button" variant="outline" className="w-full" disabled={loading}
            onClick={async () => {
              setLoading(true);
              try {
                const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: `${window.location.origin}/dashboard` });
                if (result.error) throw new Error(result.error.message ?? t("auth.errorGoogle"));
                if (result.redirected) return;
                navigate("/dashboard");
              } catch (err: any) {
                toast.error(err.message ?? t("auth.errorGoogle"));
                setLoading(false);
              }
            }}>
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.08-1.92 3.28-4.74 3.28-8.07z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.75c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.12c-.22-.66-.35-1.36-.35-2.12s.13-1.46.35-2.12V7.04H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.96l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.04l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
            </svg>
            {t("auth.google")}
          </Button>
          <div className="text-sm text-center text-muted-foreground">
            {mode === "signup" ? t("auth.haveAccount") : t("auth.noAccount")}{" "}
            <button className="text-primary font-medium hover:underline"
              onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
              {mode === "signup" ? t("auth.signin") : t("auth.ctaSignupFree")}
            </button>
          </div>
          <div className="text-center"><Link to="/" className="text-xs text-muted-foreground hover:underline">{t("auth.backHome")}</Link></div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
