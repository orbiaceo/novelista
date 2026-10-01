-- ============================================================
-- Novelista – Notizheft (Vorarbeit zu jedem Roman)
-- Einmal im Supabase-Dashboard unter "SQL Editor" einfügen und
-- auf "Run" drücken. Ändert NICHTS an den Manuskripten.
-- ============================================================

-- Ein Notizheft pro Projekt (Roman, Erzählung, Gedicht).
create table if not exists public.notizhefte (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  manuscript_id uuid not null references public.manuscripts(id) on delete cascade,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (manuscript_id)
);

-- updated_at automatisch pflegen (Funktion existiert bereits aus schema.sql)
drop trigger if exists trg_notizhefte_updated_at on public.notizhefte;
create trigger trg_notizhefte_updated_at
  before update on public.notizhefte
  for each row execute function public.set_updated_at();

-- Row Level Security: Jede Autorin sieht nur ihre eigenen Notizhefte.
alter table public.notizhefte enable row level security;

drop policy if exists "Autor liest eigenes Notizheft" on public.notizhefte;
create policy "Autor liest eigenes Notizheft"
  on public.notizhefte for select
  using (auth.uid() = user_id);

drop policy if exists "Autor erstellt eigenes Notizheft" on public.notizhefte;
create policy "Autor erstellt eigenes Notizheft"
  on public.notizhefte for insert
  with check (auth.uid() = user_id);

drop policy if exists "Autor aktualisiert eigenes Notizheft" on public.notizhefte;
create policy "Autor aktualisiert eigenes Notizheft"
  on public.notizhefte for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Autor loescht eigenes Notizheft" on public.notizhefte;
create policy "Autor loescht eigenes Notizheft"
  on public.notizhefte for delete
  using (auth.uid() = user_id);
