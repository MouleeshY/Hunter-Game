-- Keep the game profile id separate from the Supabase Auth identity.
alter table public.users
  add column if not exists auth_id uuid;

update public.users
   set auth_id = id
 where auth_id is null;

alter table public.users
  alter column auth_id set not null,
  alter column id set default gen_random_uuid();

create unique index if not exists users_auth_id_key
  on public.users (auth_id);
