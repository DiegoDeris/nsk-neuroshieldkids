/**
 * Comprobación de contraseñas filtradas, contra HaveIBeenPwned.
 * ───────────────────────────────────────────────────────────────────────────
 * Supabase ofrece esto integrado, pero solo en sus planes de pago. La misma
 * protección se consigue aquí sin coste y sin depender de ese plan.
 *
 * Por qué importa en esta app: la cuenta del padre da acceso a datos de
 * conducta de un menor. La vía de entrada más fácil no es un fallo técnico,
 * es una contraseña reutilizada que ya está publicada en alguna filtración.
 *
 * Privacidad: se usa el modelo de k-anonimato. NUNCA sale la contraseña, ni
 * su hash completo. Se envían solo los 5 primeros caracteres del hash SHA-1;
 * el servicio devuelve todos los hashes que empiezan igual (cientos) y la
 * coincidencia se comprueba aquí, en el navegador. El servidor no puede
 * saber cuál se estaba consultando.
 */

/** SHA-1 en mayúsculas, con la API del propio navegador. */
export async function sha1(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto);
  const resumen = await crypto.subtle.digest("SHA-1", datos);
  return Array.from(new Uint8Array(resumen))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export interface ResultadoFiltrada {
  /** true solo si consta en filtraciones. */
  filtrada: boolean;
  /** Veces que aparece. 0 si no consta o no se pudo comprobar. */
  apariciones: number;
  /**
   * true si la comprobación no se pudo hacer (sin red, servicio caído…).
   * En ese caso NO se bloquea el registro: dejar a un padre sin poder
   * crear la cuenta porque un servicio externo está caído sería peor.
   */
  noComprobada: boolean;
}

/**
 * Busca el sufijo del hash en la respuesta del servicio.
 * Formato de cada línea: `SUFIJO:VECES` (SUFIJO son 35 caracteres hex).
 * Separado de la llamada de red para poder probarlo sin conexión.
 */
export function contarEnRespuesta(cuerpo: string, resto: string): number {
  for (const linea of cuerpo.split("\n")) {
    const [sufijo, veces] = linea.trim().split(":");
    if (sufijo === resto) {
      const n = Number(veces ?? 0);
      // El relleno de la respuesta viene con contador 0: no es coincidencia real.
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
  }
  return 0;
}

export async function comprobarContrasenaFiltrada(
  contrasena: string,
): Promise<ResultadoFiltrada> {
  try {
    const hash = await sha1(contrasena);
    const prefijo = hash.slice(0, 5);
    const resto = hash.slice(5);

    const respuesta = await fetch(
      `https://api.pwnedpasswords.com/range/${prefijo}`,
      {
        headers: { "Add-Padding": "true" }, // relleno: oculta el tamaño real
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!respuesta.ok) return { filtrada: false, apariciones: 0, noComprobada: true };

    const apariciones = contarEnRespuesta(await respuesta.text(), resto);
    return { filtrada: apariciones > 0, apariciones, noComprobada: false };
  } catch {
    return { filtrada: false, apariciones: 0, noComprobada: true };
  }
}
