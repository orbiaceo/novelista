-- ============================================================
-- Novelista – Datenbankschema für Supabase
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und ausführen.
-- ============================================================

-- Eine zentrale Manuskript-Datei pro Autor.
create table if not exists public.manuscripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Mein Roman',
  content text not null default '',
  word_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

-- updated_at automatisch pflegen
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_manuscripts_updated_at on public.manuscripts;
create trigger trg_manuscripts_updated_at
  before update on public.manuscripts
  for each row execute function public.set_updated_at();

-- ============================================================
-- Row Level Security: Jeder Autor sieht ausschließlich
-- sein eigenes Manuskript.
-- ============================================================
alter table public.manuscripts enable row level security;

drop policy if exists "Autor liest eigenes Manuskript" on public.manuscripts;
create policy "Autor liest eigenes Manuskript"
  on public.manuscripts for select
  using (auth.uid() = user_id);

drop policy if exists "Autor erstellt eigenes Manuskript" on public.manuscripts;
create policy "Autor erstellt eigenes Manuskript"
  on public.manuscripts for insert
  with check (auth.uid() = user_id);

drop policy if exists "Autor aktualisiert eigenes Manuskript" on public.manuscripts;
create policy "Autor aktualisiert eigenes Manuskript"
  on public.manuscripts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Autor loescht eigenes Manuskript" on public.manuscripts;
create policy "Autor loescht eigenes Manuskript"
  on public.manuscripts for delete
  using (auth.uid() = user_id);
