#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Genera los dos ficheros que hacen que el QR abra la app directamente.
#
# Sin ellos, el enlace del QR abre el navegador en lugar de NeuroShield Kids,
# y la instalación deja de ser de un solo paso.
#
# Cómo obtener la huella de Android:
#   Play Console → tu app → Versiones → Configuración → Firma de apps
#   Copia "Huella digital del certificado SHA-256" del certificado de
#   firma de apps (el de Google, NO el de carga).
#
#   Importante: si usas Firma de apps de Google Play —y es lo recomendable—
#   Google vuelve a firmar el AAB, así que la huella válida es la suya.
#   La de tu keystore local no sirve para esto.
#
# Cómo obtener el Team ID de Apple:
#   developer.apple.com → Membership → Team ID (10 caracteres)
#
# Uso:
#   ./configurar-enlaces-app.sh SHA256_ANDROID [TEAM_ID_APPLE]
#
# Ejemplo:
#   ./configurar-enlaces-app.sh AB:CD:12:...:EF A1B2C3D4E5
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SHA="${1:-}"
TEAM="${2:-}"
PAQUETE="com.neuroshield.nsk"
BUNDLE_ID="com.neuroshield.nsk"

if [ -z "$SHA" ]; then
  sed -n '2,25p' "$0" | sed 's/^# \?//'
  exit 1
fi

# Normaliza: acepta con o sin dos puntos, en mayúsculas o minúsculas.
SHA_LIMPIO="$(echo "$SHA" | tr -d ' ' | tr 'a-f' 'A-F' | tr -d ':')"
if ! echo "$SHA_LIMPIO" | grep -qE '^[0-9A-F]{64}$'; then
  echo "❌ La huella no parece un SHA-256 válido (se esperan 64 caracteres hexadecimales)."
  echo "   Recibido: ${#SHA_LIMPIO} caracteres."
  exit 1
fi
# Vuelve a insertar los dos puntos cada dos caracteres, que es el formato exigido.
SHA_FMT="$(echo "$SHA_LIMPIO" | sed 's/../&:/g; s/:$//')"

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$RAIZ/public/.well-known"
mkdir -p "$DEST"

cat > "$DEST/assetlinks.json" <<JSON
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "$PAQUETE",
      "sha256_cert_fingerprints": ["$SHA_FMT"]
    }
  }
]
JSON
echo "✅ $DEST/assetlinks.json"

if [ -n "$TEAM" ]; then
  cat > "$DEST/apple-app-site-association" <<JSON
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "$TEAM.$BUNDLE_ID",
        "paths": ["/s/*"]
      }
    ]
  }
}
JSON
  echo "✅ $DEST/apple-app-site-association"
else
  echo "ℹ️  Sin Team ID de Apple: se omite el fichero de iOS. Vuelve a ejecutarlo cuando lo tengas."
fi

echo ""
echo "Siguiente paso: despliega la web para que los ficheros queden públicos, y comprueba"
echo "que responden (deben devolver JSON, no la página de la app):"
echo "  https://nsk-neuroshieldkids.vercel.app/.well-known/assetlinks.json"
