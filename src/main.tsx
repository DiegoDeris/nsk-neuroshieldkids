import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";

const SENSITIVE_KEYS = ["email", "password", "token", "phone"];

function filterSensitiveData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => filterSensitiveData(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.some((sensitive) => key.toLowerCase().includes(sensitive))) {
        result[key] = "[Filtered]";
      } else {
        result[key] = filterSensitiveData(val);
      }
    }
    return result as unknown as T;
  }
  return value;
}

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN ?? "",
  environment: import.meta.env.MODE,
  tracesSampleRate: 0.2,
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
  beforeSend(event) {
    if (event.user) {
      delete event.user.email;
      delete event.user.ip_address;
    }
    if (event.request?.data) {
      event.request.data = filterSensitiveData(event.request.data);
    }
    if (event.extra) {
      event.extra = filterSensitiveData(event.extra);
    }
    return event;
  },
});

window.addEventListener("unhandledrejection", (e) => {
  Sentry.captureException(e.reason);
});
window.addEventListener("error", (e) => {
  Sentry.captureException(e.error ?? e.message);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
