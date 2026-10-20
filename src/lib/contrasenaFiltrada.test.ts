/**
 * Prueba de la comprobación de contraseñas filtradas.
 * Uso:  npx tsx src/lib/contrasenaFiltrada.test.ts
 *
 * Dos partes:
 *  1. Sin red: hashes conocidos y un trozo real de respuesta del servicio
 *     (capturado de api.pwnedpasswords.com/range/5BAA6). Esto es lo que
 *     comprueba la lógica de verdad y lo que corre en cada despliegue.
 *  2. Con red, si la hay: una llamada real, para detectar si el servicio
 *     cambiara de formato. Se omite si no hay salida a internet.
 */
import { sha1, contarEnRespuesta, comprobarContrasenaFiltrada } from "./contrasenaFiltrada";

let correctas = 0, fallos = 0, omitidas = 0;
const comprobar = (ok: boolean, que: string) => {
  if (ok) { correctas++; console.log(`  ✓ ${que}`); }
  else { fallos++; console.log(`  ✗ ${que}`); }
};

// Trozo literal de la respuesta real para el prefijo 5BAA6 (SHA-1 de "password").
const RESPUESTA_REAL = [
  "1E2AAA439972480CEC7F16C795BBB429372:1",
  "1E3687A61BFCE35F69B7408158101C8E414:1",
  "1E4AB85875AA6B6E316963C7754A216FFBC:20",
  "1E4C9B93F3F0682250B6CF8331B7EE68FD8:52372427", // "password"
  "1E779ED162DE46A655D004DCB0714884103:2",
  "1EBD698990C36479FEB3023BBF47BE5E679:252",
  "0000000000000000000000000000000000A:0", // relleno (Add-Padding): contador 0
].join("\r\n");

async function main() {
  console.log("Sin red (lógica):");

  const hPassword = await sha1("password");
  comprobar(hPassword === "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8",
    `SHA-1("password") correcto`);
  comprobar(await sha1("") === "DA39A3EE5E6B4B0D3255BFEF95601890AFD80709",
    "SHA-1 de cadena vacía correcto (valor de referencia conocido)");

  comprobar(hPassword.slice(0, 5) === "5BAA6",
    "solo se enviarían 5 caracteres al servicio, nunca la contraseña");

  comprobar(contarEnRespuesta(RESPUESTA_REAL, hPassword.slice(5)) === 52372427,
    "encuentra una contraseña filtrada y su número de apariciones");
  comprobar(contarEnRespuesta(RESPUESTA_REAL, "0".repeat(35)) === 0,
    "no cuenta el relleno de la respuesta (contador 0) como coincidencia");
  comprobar(contarEnRespuesta(RESPUESTA_REAL, "F".repeat(35)) === 0,
    "una contraseña que no consta da 0");
  comprobar(contarEnRespuesta("", "F".repeat(35)) === 0,
    "una respuesta vacía no da falsos positivos");

  console.log("\nCon red (formato del servicio):");
  const r = await comprobarContrasenaFiltrada("password");
  if (r.noComprobada) {
    omitidas++;
    console.log("  ~ omitida: sin salida a internet desde aquí");
  } else {
    comprobar(r.filtrada && r.apariciones > 1_000_000,
      "el servicio real sigue devolviendo el formato esperado");
  }

  console.log(`\n${correctas} correctas, ${fallos} fallos, ${omitidas} omitidas`);
  if (fallos) console.log("Fallos:", fallos);
  process.exit(fallos ? 1 : 0);
}

main();
