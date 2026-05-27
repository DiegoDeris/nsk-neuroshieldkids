-- install_tokens: temporary pairing tokens (one-use, expiring)
create table if not exists public.install_tokens (
  id          uuid primary key default gen_random_uuid(),
  token       text unique not null,
  child_id    uuid not null references public.children(id) on delete cascade,
  parent_id   uuid not null references auth.users(id) on delete cascade,
  expires_at  timestamptz not null default (now() + interval '48 hours'),
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists install_tokens_token_idx on public.install_tokens(token);
create index if not exists install_tokens_child_id_idx on public.install_tokens(child_id);

alter table public.install_tokens enable row level security;

-- Parent can read/delete their own tokens
create policy "parent_rw_install_tokens" on public.install_tokens
  for all using (auth.uid() = parent_id)
  with check (auth.uid() = parent_id);

-- devices: registered Android devices per child
create table if not exists public.devices (
  id                  uuid primary key default gen_random_uuid(),
  child_id            uuid not null references public.children(id) on delete cascade,
  parent_id           uuid not null references auth.users(id) on delete cascade,
  device_model        text,
  android_version     text,
  device_fingerprint  text,
  registered_at       timestamptz not null default now(),
  last_seen_at        timestamptz
);

create index if not exists devices_child_id_idx on public.devices(child_id);

alter table public.devices enable row level security;

create policy "parent_rw_devices" on public.devices
  for all using (auth.uid() = parent_id)
  with check (auth.uid() = parent_id);
