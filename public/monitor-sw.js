// NeuroShield Kids — Monitor Service Worker
//
// IMPORTANTE — lo que este archivo NO hace, y por qué:
//
// La versión anterior fabricaba un evento falso cada vez que el sistema lo
// despertaba: app_name "Safari iOS", 120 segundos de uso, interacciones a
// cero. Nada de eso se medía; se inventaba. Ese dato entraba en la base y el
// motor clínico lo trataba como tiempo de pantalla real de un menor.
//
// Eso está eliminado. Un service worker no puede observar qué apps usa el
// niño, ni sus desbloqueos, ni su sueño: solo ve su propia página. Inventar
// esos datos en un producto de salud mental infantil es peor que no tener
// producto, porque un padre puede quedarse tranquilo con una cifra falsa.
//
// Este service worker se limita ahora a reenviar mediciones reales que se
// quedaron sin enviar por falta de cobertura. Si no hay nada real pendiente,
// no envía nada.

const INGEST_URL = "https://lqvgspmjfkfdurdnejzs.supabase.co/functions/v1/ingest-usage";
const DB_NAME = "nsk-monitor";
const DB_VERSION = 1;
const STORE = "config";
const SYNC_TAG = "nsk-bg-sync";

// ── IndexedDB ─────────────────────────────────────────────────────────────────

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

function idbGet(key) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function idbSet(key, value) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function idbDelete(key) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

// ── Reenvío de mediciones REALES pendientes ──────────────────────────────────

/**
 * Envía únicamente eventos que la página midió de verdad y no pudo entregar.
 * Si la cola está vacía, no se envía nada: no se inventa actividad.
 */
async function flushPending() {
  const token = await idbGet("token");
  if (!token || token.length < 16) return;

  const pending = (await idbGet("pending")) || [];
  if (!Array.isArray(pending) || pending.length === 0) return;

  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ token, events: pending }),
  });

  if (res.ok) {
    await idbSet("pending", []);
    return;
  }

  // Token rechazado: se borra para dejar de reintentar en bucle y para que la
  // página pida uno nuevo. Antes se reintentaba indefinidamente con un token
  // caducado, generando errores sin fin y sin explicación para el padre.
  if (res.status === 401 || res.status === 403) {
    await idbDelete("token");
    await idbSet("token_rejected_at", Date.now());
  }
}

self.addEventListener("periodicsync", (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(flushPending());
});

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(flushPending());
});

self.addEventListener("fetch", () => {});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("install", () => {
  self.skipWaiting();
});
