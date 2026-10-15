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
