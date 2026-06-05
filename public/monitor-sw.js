// NeuroShield Kids — Monitor Service Worker
// Envía datos de uso en background aunque la página esté cerrada.
// Requiere: Chrome Android + PWA instalada.

const INGEST_URL = "https://lqvgspmjfkfdurdnejzs.supabase.co/functions/v1/ingest-usage";
const DB_NAME = "nsk-monitor";
const DB_VERSION = 1;
const STORE = "config";
const SYNC_TAG = "nsk-bg-sync";

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function getConfig() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get("token");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Envío de evento ───────────────────────────────────────────────────────────

async function sendBgEvent() {
  const token = await getConfig();
  if (!token || token.length < 16) return;

  const now = new Date();
  const hour = now.getHours();

  const event = {
    app_name: "Safari iOS",
    duration_seconds: 120,
    occurred_at: now.toISOString(),
    event_type: "app_usage",
    metadata: {
      interactions_per_min: 0,
      visibility_changes: 0,
      orientation_changes: 0,
      is_night: hour >= 22 || hour < 7,
      hour_of_day: hour,
      battery_drain_percent: 0,
      network_type: "unknown",
      session_minutes: 2,
      platform: "ios_web",
      source: "background_sync",
    },
  };

  await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, events: [event] }),
  });
}

// ── Periodic Background Sync (Chrome Android) ─────────────────────────────────

self.addEventListener("periodicsync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(sendBgEvent());
  }
});

// ── Background Sync (one-shot fallback) ──────────────────────────────────────

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(sendBgEvent());
  }
});

// ── Fetch: pass-through (sin caché) ──────────────────────────────────────────

self.addEventListener("fetch", () => {});

// ── Activate: toma control inmediato ─────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("install", () => {
  self.skipWaiting();
});
