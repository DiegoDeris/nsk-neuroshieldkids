# Avisos de seguridad de Supabase: qué se arregló y qué queda

Comprobado el 16/10/2026 contra el proyecto de producción.

## Arreglados

**1. Funciones sin `search_path` fijo** (`fn_notify_alert`, `cleanup_old_usage_events`)

Estas funciones corren con permisos elevados. Sin el esquema fijado, alguien
que pudiera crear una tabla o función con el mismo nombre en otro esquema
podría conseguir que ejecutaran su código. Fijado a `public`.
Migración: `20261016_seguridad_avisos.sql`.

**2. Tablas internas sin reglas de acceso**

`app_settings`, `cron_failures`, `failed_webhooks`, `ingest_rate_limits` y
`processed_stripe_events` no son de ningún usuario: guardan configuración,
fallos del cron y control de abuso. Ahora tienen una regla restrictiva que
niega todo a quien entre por la app. Comprobado desde fuera, como visitante
anónimo: `401 permission denied for table app_settings`.

**3. Contraseñas filtradas**

Supabase comprueba las contraseñas contra HaveIBeenPwned, pero **solo en
planes de pago**: su API responde `402 Pro Plans and up`. La comprobación se
hace ahora desde la propia app, gratis y con la misma base de datos de
filtraciones: `src/lib/contrasenaFiltrada.ts`, aplicada al registro y al
cambio de contraseña.

Nunca sale la contraseña del dispositivo. Se envían los 5 primeros caracteres
de su huella SHA-1, el servicio devuelve cientos de huellas que empiezan
igual, y la comparación se hace en el navegador (modelo de k-anonimato). Si
el servicio no responde, no se bloquea el registro: dejar a un padre fuera
porque un servicio ajeno está caído sería peor que el riesgo que evita.

El aviso de Supabase **seguirá apareciendo** en su panel, porque mira su
propio interruptor de pago, no la app. Está cubierto igualmente.

## Queda abierto (con matiz importante)

**`pg_net` registrado en el esquema `public`**

Qué es: la extensión que permite a la base de datos hacer peticiones HTTP.
La usa el cron que lanza el análisis diario.

Por qué sigue ahí, con datos y no con suposiciones:

- `pg_net` tiene `extrelocatable = false`: Postgres **se niega** a moverla de
  esquema. Es una limitación de la extensión, no una decisión nuestra.
- Los permisos sobre el esquema `net` los concedió `supabase_admin`. Nosotros
  conectamos como `postgres`, que **no es miembro** de ese rol, así que un
  `REVOKE` nuestro no hace nada. *(Esto importa: en una revisión anterior di
  por hecho que el revoke había funcionado. No había funcionado. Postgres no
  da error en ese caso, simplemente lo ignora.)*
- Borrarla y recrearla en otro esquema **rompería el análisis diario**, y
  `pg_net` vuelve a crear su esquema `net` de todas formas.

Por qué, aun así, no es una puerta abierta — comprobado desde internet con la
clave pública, igual que podría hacerlo cualquiera:

- El esquema `net` **no está publicado** en la API:
  `PGRST106 — Only the following schemas are exposed: public, graphql_public`.
- La única función de `public` que llama a `net.http_*` es `fn_notify_alert`,
  y **no es ejecutable** por `anon` ni por `authenticated`:
  `PGRST202 — Could not find the function`.

Es decir: el permiso existe dentro de la base de datos, pero no hay ninguna
vía desde fuera para usarlo. Para cerrarlo del todo haría falta que el
soporte de Supabase ejecute el `REVOKE` como `supabase_admin`.

**Si algún día se publica otro esquema en la API, hay que revisar esto.**
