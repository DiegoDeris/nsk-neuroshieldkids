/**
 * Retirada del monitor web.
 * ─────────────────────────────────────────────────────────────────────────
 * El monitor web ha sido sustituido por la app nativa de Android. Esta
 * página solo sabía cuánto tiempo estuvo ella misma abierta, que no es el
 * uso real del móvil, y el motor clínico ya rechaza esos datos.
 *
 * Este archivo NO se puede borrar sin más: un service worker sigue vivo en
 * todos los móviles donde se llegó a registrar aunque el archivo desaparezca
 * del servidor. Si lo borrásemos, seguiría ejecutándose la versión antigua
 * durante meses, sirviendo páginas cacheadas y posiblemente enviando datos.
 *
 * Así que lo que queda aquí es su desinstalación: se activa de inmediato,
 * borra sus cachés, se da de baja y recarga las pestañas abiertas para que
 * dejen de depender de él.
 */

self.addEventListener("install", () => {
  // No esperar a que se cierren las pestañas: esto tiene que ocurrir ya.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const nombres = await caches.keys();
        await Promise.all(nombres.map((n) => caches.delete(n)));
      } catch (_) {
        // Si el borrado de cachés falla, la baja sigue siendo lo importante.
      }

      await self.registration.unregister();

      const clientes = await self.clients.matchAll({ type: "window" });
      for (const cliente of clientes) {
        try {
          cliente.navigate(cliente.url);
        } catch (_) {
          // Una pestaña que no se deje recargar se arreglará sola al abrirse
          // de nuevo: el service worker ya está dado de baja.
        }
      }
    })(),
  );
});

// Sin fetch ni sync: no intercepta nada y no envía nada.
