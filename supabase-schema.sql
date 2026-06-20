-- SHTER bandkalender - database schema
-- Uitvoeren in Supabase: Project > SQL Editor > New query > plak dit > Run

-- Bandleden
create table members (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Blokkades: 1 rij per (datum, lid)
create table blocks (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  member_name text not null references members(name) on delete cascade,
  note text default '',
  created_at timestamptz not null default now(),
  unique (date, member_name)
);

-- Repetitievoorstellen: meerdere per datum mogelijk
create table proposals (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  time text not null,           -- bv. "20:00"
  label text default '',
  proposed_by text not null references members(name) on delete cascade,
  confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

-- Indexen voor snelle maand-queries
create index blocks_date_idx on blocks (date);
create index proposals_date_idx on proposals (date);

-- Row Level Security: uit voor dit project (geen login-systeem, hele band
-- deelt 1 link). Voor een prive/openbare deploy kun je dit later aanscherpen.
alter table members enable row level security;
alter table blocks enable row level security;
alter table proposals enable row level security;

create policy "iedereen mag lezen en schrijven - members"
  on members for all using (true) with check (true);
create policy "iedereen mag lezen en schrijven - blocks"
  on blocks for all using (true) with check (true);
create policy "iedereen mag lezen en schrijven - proposals"
  on proposals for all using (true) with check (true);

-- Startdata: de band
insert into members (name, color, sort_order) values
  ('Niels', '#C9744A', 0),
  ('Fleur', '#8A6A4F', 1),
  ('Raf',   '#B5944B', 2),
  ('Ilia',  '#6F8068', 3),
  ('Bram',  '#A35238', 4),
  ('Thijs', '#7A6A8A', 5),
  ('Steven','#C2A05E', 6);
