-- register-device hacía upsert con onConflict device_fingerprint sin que
-- existiera índice único. Postgres lo rechazaba, la función no comprobaba el
-- error y respondía éxito: el móvil quedaba midiendo pero sin aparecer en el
-- panel, así que el padre no podía verlo ni revocarlo.
--
-- El índice NO puede ser parcial: Postgres no usa índices parciales para
-- resolver ON CONFLICT. Uno normal basta, porque trata los nulos como
-- distintos entre sí y varios dispositivos sin huella no colisionan.
create unique index if not exists devices_device_fingerprint_key
  on public.devices (device_fingerprint);
