# Carpeta .well-known

Aquí van los dos ficheros que hacen que el enlace del QR abra la app nativa
directamente, en lugar de abrir el navegador:

- `assetlinks.json` → Android
- `apple-app-site-association` → iOS

**No se escriben a mano.** Los genera:

```
nsk-v2/scripts/configurar-enlaces-app.sh SHA256_ANDROID [TEAM_ID_APPLE]
```

Se pueden crear solo cuando existan los datos que requieren:

| Fichero | Dato necesario | De dónde sale |
|---|---|---|
| `assetlinks.json` | Huella SHA-256 del certificado de **firma de apps** | Play Console → Versiones → Configuración → Firma de apps (la huella de Google, no la de carga) |
| `apple-app-site-association` | Team ID de Apple | developer.apple.com → Membership |

Mientras no existan, el QR sigue funcionando por el esquema propio `nsk://setup`
en móviles que ya tengan la app instalada; lo que no funciona es el enlace
diferido desde la tienda.

## Por qué hay una regla en vercel.json

`apple-app-site-association` no tiene extensión, así que el servidor no sabe
que es JSON. Apple exige que se sirva como `application/json` o los enlaces
universales de iOS no se verifican. Por eso hay una entrada para ese fichero
en `headers` dentro de `vercel.json`.

Ojo al tocar ese archivo: **Vercel rechaza cualquier clave que no reconozca**
y el despliegue falla. Nada de añadir un campo `comment` para explicar una
regla; las explicaciones van aquí.

## Comprobación tras desplegar — las dos URL deben devolver JSON, no la página web:

- https://nsk-neuroshieldkids.vercel.app/.well-known/assetlinks.json
- https://nsk-neuroshieldkids.vercel.app/.well-known/apple-app-site-association
