import { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useLocation } from "react-router-dom";

export const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Cargando…</div>;
  }
  if (!user) return <Navigate to="/auth" state={{ from: location }} replace />;
  return <>{children}</>;
};
