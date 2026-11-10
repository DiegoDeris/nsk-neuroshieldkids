#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
#  Verificación previa al despliegue.
#
#  Existe porque se desplegó a producción sin comprobar y la web estuvo dos
#  semanas caída sirviendo una versión antigua: bastaba una clave desconocida
#  en vercel.json. Cada comprobación de aquí corresponde a un fallo real que
#  ya ocurrió. No añadas una sin que haya pasado de verdad.
#
#  Uso:  ./scripts/verificar.sh
#  Sale con código 1 si algo falla. No despliegues si eso ocurre.
# ═══════════════════════════════════════════════════════════════════════════
set -u
cd "$(dirname "$0")/.." || exit 1
FALLOS=0
paso() { printf '\n── %s\n' "$1"; }
mal()  { echo "   ✗ $1"; FALLOS=$((FALLOS+1)); }
bien() { echo "   ✓ $1"; }

paso "Tipos"
if npx tsc --noEmit 2>&1 | grep -q .; then
  npx tsc --noEmit 2>&1 | head -10 | sed 's/^/   /'
  mal "errores de tipos"
else bien "sin errores de tipos"; fi

paso "Compilación"
if npx vite build >/tmp/nsk-build.log 2>&1; then bien "compila"
else tail -15 /tmp/nsk-build.log | sed 's/^/   /'; mal "la compilación falla"; fi

paso "Motores clínicos"
for t in clinicalEngine forecastEngine; do
  if npx tsx "supabase/functions/_shared/$t.test.ts" >/tmp/nsk-$t.log 2>&1; then
    bien "$t: $(grep -o '[0-9]* correctas' /tmp/nsk-$t.log | tail -1)"
  else
    grep -A3 'Fallos:' /tmp/nsk-$t.log | sed 's/^/   /'
    mal "$t con pruebas fallidas"
  fi
done

paso "Contraseñas filtradas"
# Supabase solo ofrece esta protección en planes de pago, así que la hace la
# propia app contra HaveIBeenPwned. Si se rompe, cualquiera podría registrarse
# con una contraseña ya publicada en filtraciones.
if npx tsx src/lib/contrasenaFiltrada.test.ts >/tmp/nsk-hibp.log 2>&1; then
  bien "$(grep -oE '[0-9]+ correctas' /tmp/nsk-hibp.log | tail -1)"
else
  grep '✗' /tmp/nsk-hibp.log | sed 's/^/   /'
  mal "la comprobación de contraseñas filtradas no funciona"
fi
# La comprobación necesita permiso explícito en la cabecera de seguridad:
# si falta, el navegador bloquea la llamada y nadie se entera.
if grep -q 'api.pwnedpasswords.com' vercel.json; then
  bien "la cabecera de seguridad permite la comprobación"
else
  mal "falta api.pwnedpasswords.com en connect-src de vercel.json"
fi

paso "Configuración y textos"
python3 - <<'PY' || exit 1
import json, os, sys
fallos = 0
for p in ['vercel.json','public/manifest.json','package.json',
          'src/i18n/locales/es.json','src/i18n/locales/en.json']:
    try: json.load(open(p)); print(f'   ✓ {p}')
    except Exception as e: print(f'   ✗ {p}: {e}'); fallos += 1

# Vercel rechaza claves que no reconoce y el despliegue falla entero.
v = json.load(open('vercel.json'))
for h in v.get('headers', []):
    extra = set(h) - {'source','headers','has','missing'}
    if extra: print('   ✗ vercel.json, claves no permitidas:', extra); fallos += 1
for r in v.get('rewrites', []):
    extra = set(r) - {'source','destination','has','missing'}
    if extra: print('   ✗ vercel.json rewrites, claves no permitidas:', extra); fallos += 1

# Los dos idiomas tienen que tener exactamente las mismas claves.
def planas(d, pre=''):
    o = {}
    for k, val in d.items():
        o.update(planas(val, pre+k+'.')) if isinstance(val, dict) else o.update({pre+k: val})
    return o
es, en = planas(json.load(open('src/i18n/locales/es.json'))), planas(json.load(open('src/i18n/locales/en.json')))
if set(es) != set(en):
    print('   ✗ textos descuadrados. solo en es:', sorted(set(es)-set(en))[:5],
          '| solo en en:', sorted(set(en)-set(es))[:5]); fallos += 1
else: print(f'   ✓ es/en con las mismas {len(es)} claves')

# Un icono que falta en el manifiesto rompe la instalación sin avisar.
for i in json.load(open('public/manifest.json'))['icons']:
    if os.path.exists('public'+i['src']): print(f"   ✓ {i['src']}")
    else: print(f"   ✗ falta public{i['src']}"); fallos += 1
sys.exit(1 if fallos else 0)
PY
[ $? -ne 0 ] && FALLOS=$((FALLOS+1))

paso "Páginas legales legibles sin JavaScript"
# El revisor automático de Google Play no ejecuta JavaScript: en /privacy
# veía una página en blanco. Sin una copia estática, el envío se rechaza.
if [ -f public/privacidad.html ] && grep -q 'eliminar tus datos' public/privacidad.html; then
  bien "privacidad.html existe y explica cómo eliminar los datos"
else
  mal "falta public/privacidad.html o no explica el borrado de datos"
fi

paso "Correo de privacidad alcanzable"
# La política anunciaba privacidad@nsk.app, un dominio que no es nuestro: el
# buzón no existía y nadie podía ejercer sus derechos de RGPD. El correo tiene
# que estar en un dominio nuestro y con buzón de verdad (Cloudflare Email
# Routing reenvía privacidad@neuroshieldkids.com al Gmail del responsable).
CORREOS=$(grep -rhoE '[a-z]+@[a-z0-9.-]+\.[a-z]{2,}' \
  public/privacidad.html src/pages/Privacy.tsx 2>/dev/null | sort -u)
AJENOS=$(echo "$CORREOS" | grep -v '@neuroshieldkids\.com$' | grep -v '^$')
if [ -n "$AJENOS" ]; then
  echo "$AJENOS" | sed 's/^/   /'
  mal "la política de privacidad da correos de dominios que no controlamos"
else
  bien "todos los correos de la política son de neuroshieldkids.com"
fi

paso "Enlaces de emparejamiento de Android"
# Sin assetlinks.json, Android no verifica los dominios declarados en el
# manifiesto y el enlace /install/TOKEN no abre la app. No da ningun error:
# simplemente abre el navegador y el padre cree que la app no funciona.
python3 - <<'PY' || exit 1
import json, re, sys, os
fallos = 0
ruta = 'public/.well-known/assetlinks.json'
if not os.path.exists(ruta):
    print('   ✗ falta', ruta); sys.exit(1)
try:
    datos = json.load(open(ruta))
except Exception as e:
    print('   ✗ assetlinks.json no es JSON válido:', e); sys.exit(1)
huellas = set()
for bloque in datos:
    t = bloque.get('target', {})
    if t.get('package_name') != 'com.neuroshield.nsk':
        print('   ✗ paquete inesperado:', t.get('package_name')); fallos += 1
    for h in t.get('sha256_cert_fingerprints', []):
        if not re.fullmatch(r'([0-9A-F]{2}:){31}[0-9A-F]{2}', h):
            print('   ✗ huella con formato incorrecto:', h[:20], '…'); fallos += 1
        huellas.add(h)
if not huellas:
    print('   ✗ assetlinks.json sin ninguna huella'); fallos += 1
else:
    print(f'   ✓ assetlinks.json con {len(huellas)} huella(s) para com.neuroshield.nsk')

# Todo dominio declarado en el manifiesto tiene que servir este archivo.
man = '../nsk-android/app/src/main/AndroidManifest.xml'
if os.path.exists(man):
    hosts = sorted(set(re.findall(r'android:host="([^"]+)"', open(man).read())) - {'setup'})
    print('   · dominios declarados en Android:', ', '.join(hosts))
sys.exit(1 if fallos else 0)
PY
[ $? -ne 0 ] && FALLOS=$((FALLOS+1))

paso "Enlaces internos"
python3 - <<'PY' || exit 1
import re, subprocess, sys
rutas = set(re.findall(r'<Route path="([^"]+)"', open('src/App.tsx').read()))
out = subprocess.run(['grep','-rhoE','to="/[a-z/:-]*"','--include=*.tsx','src'],
                     capture_output=True, text=True).stdout
enlaces = {l.split('"')[1] for l in out.splitlines()}
def cubre(e):
    return any(re.match('^'+re.sub(r':[^/]+','[^/]+',r).replace('*','.*')+'$', e) for r in rutas)
rotos = sorted(e for e in enlaces if not cubre(e))
print('   ✗ enlaces a rutas inexistentes: '+str(rotos) if rotos else f'   ✓ {len(enlaces)} enlaces, ninguno roto')
sys.exit(1 if rotos else 0)
PY
[ $? -ne 0 ] && FALLOS=$((FALLOS+1))

paso "El despliegue no revierte arreglos de base de datos"
# production_hardening contiene una version antigua de
# aggregate_events_to_metric. Si se aplica DESPUES de un arreglo posterior,
# lo deshace en silencio: la funcion vuelve a la version del monitor web y
# el analisis diario deja de ver las senales nativas.
ORDEN=$(grep -oE 'supabase/migrations/[0-9a-z_]+\.sql' ../deploy-r6.command 2>/dev/null)
if [ -z "$ORDEN" ]; then
  bien "no se encontro deploy-r6.command (se omite)"
else
  ORDENADAS=$(echo "$ORDEN" | sed 's|.*/||' | sort -c 2>&1 || echo "DESORDEN")
  if [ "$ORDENADAS" = "DESORDEN" ]; then
    echo "$ORDEN" | sed 's/^/   /'
    mal "las migraciones del despliegue no van en orden cronologico"
  else bien "migraciones en orden: la mas reciente se aplica la ultima"; fi
  # Toda migracion listada tiene que poder reaplicarse sin fallar.
  NOIDEM=""
  for m in $ORDEN; do
    f="$m"
    [ -f "$f" ] || continue
    if grep -qiE 'add constraint' "$f" && ! grep -qiE 'drop constraint if exists' "$f"; then
      NOIDEM="$NOIDEM $f"
    fi
  done
  if [ -n "$(echo "$NOIDEM" | tr -d '[:space:]')" ]; then
    echo "  $NOIDEM" | tr ' ' '\n' | sed 's/^/   /'
    mal "migraciones que fallarian al reaplicarse"
  else bien "todas las migraciones del despliegue son reaplicables"; fi
fi

paso "Errores que se descartan (la causa de casi todos los fallos)"
# Un error ignorado convierte un fallo en un exito aparente. Asi se perdio el
# analisis diario entero, el registro del dispositivo y el codigo de
# instalacion: ninguno dio error nunca, simplemente no hacian nada.
SILENCIOSOS=$(grep -rnE '^\s*await (admin|userClient|supabase)\.(from|rpc)\(' \
  supabase/functions/*/index.ts 2>/dev/null)
SILENCIOSOS="$SILENCIOSOS$(grep -rnE 'await supabase\.from\("[a-z_]+"\)\.(insert|update|delete|upsert)' \
  --include=*.tsx src/pages src/components 2>/dev/null | grep -v 'error')"
if [ -n "$(echo "$SILENCIOSOS" | tr -d '[:space:]')" ]; then
  echo "$SILENCIOSOS" | sed 's/^/   /' | head -12
  mal "hay escrituras sin comprobar el error"
else bien "todas las escrituras comprueban el error"; fi

paso "Restos del monitor web retirado"
RESTOS=$(grep -rn 'pages/Monitor\|ConnectWizard\|ConnectDevice\|"/monitor"\|TestApp' \
         --include=*.tsx --include=*.ts src 2>/dev/null | grep -v types.ts)
if [ -n "$RESTOS" ]; then echo "$RESTOS" | sed 's/^/   /'; mal "quedan restos"
else bien "sin restos"; fi

echo
echo "═══════════════════════════════════════════════════════════"
if [ "$FALLOS" -eq 0 ]; then
  echo "  ✅ Todo correcto. Se puede desplegar."
else
  echo "  ❌ $FALLOS comprobación(es) fallida(s). NO despliegues."
fi
echo "═══════════════════════════════════════════════════════════"
exit "$FALLOS"
