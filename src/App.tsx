import "@/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Children from "./pages/Children";
import ChildDetail from "./pages/ChildDetail";
import Alerts from "./pages/Alerts";
import Rules from "./pages/Rules";
import Devices from "./pages/Devices";
import Quests from "./pages/Quests";
import Learn from "./pages/Learn";
import Pricing from "./pages/Pricing";
import Connect from "./pages/Connect";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner position="top-right" richColors />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/connect" element={<Connect />} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/children" element={<ProtectedRoute><Children /></ProtectedRoute>} />
            <Route path="/child/:id" element={<ProtectedRoute><ChildDetail /></ProtectedRoute>} />
            <Route path="/alerts" element={<ProtectedRoute><Alerts /></ProtectedRoute>} />
            <Route path="/rules" element={<ProtectedRoute><Rules /></ProtectedRoute>} />
            <Route path="/devices" element={<ProtectedRoute><Devices /></ProtectedRoute>} />
            <Route path="/quests" element={<ProtectedRoute><Quests /></ProtectedRoute>} />
            <Route path="/learn" element={<ProtectedRoute><Learn /></ProtectedRoute>} />
            <Route path="/pricing" element={<ProtectedRoute><Pricing /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
