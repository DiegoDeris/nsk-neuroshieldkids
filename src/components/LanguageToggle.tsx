import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Languages } from "lucide-react";

export const LanguageToggle = ({ variant = "outline" as const, compact = false }) => {
  const { i18n } = useTranslation();
  const current = (i18n.resolvedLanguage || i18n.language || "es").startsWith("en") ? "en" : "es";
  const next = current === "es" ? "en" : "es";
  const change = () => {
    i18n.changeLanguage(next);
    try { localStorage.setItem("nsk_lang", next); } catch {}
    document.documentElement.lang = next;
  };
  return (
    <Button
      type="button"
      size={compact ? "sm" : "default"}
      variant={variant}
      onClick={change}
      aria-label="Change language"
      className="gap-1.5 px-2 sm:px-3 shrink-0"
    >
      <Languages className="h-4 w-4" />
      <span className="font-semibold">{current.toUpperCase()}</span>
      <span className="hidden sm:inline text-muted-foreground">/ {next.toUpperCase()}</span>
    </Button>
  );
};
