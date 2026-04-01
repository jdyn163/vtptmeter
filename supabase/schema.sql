-- VTPT Meter — Full Schema Migration
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT DO NOTHING

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  pin         text not null unique,
  display_name text not null,
  role        text not null default 'user' check (role in ('user', 'admin')),
  created_at  timestamptz not null default now()
);

create table if not exists cycles (
  id          text primary key,           -- e.g. '2026-03'
  status      text not null default 'active' check (status in ('active', 'closed')),
  created_by  uuid references users(id),
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz
);

create table if not exists houses (
  id text primary key                     -- 'A0' through 'A6'
);

create table if not exists rooms (
  id          text primary key,           -- e.g. 'A0-01'
  house_id    text not null references houses(id)
);

create table if not exists readings (
  id          bigint primary key generated always as identity,
  room_id     text not null references rooms(id),
  cycle_id    text not null references cycles(id),
  recorded_at date not null,
  dien        numeric,
  nuoc        numeric,
  notes       text,
  created_by  uuid references users(id),
  created_at  timestamptz not null default now()
);

create table if not exists logs (
  id          bigint primary key generated always as identity,
  room_id     text not null references rooms(id),
  action      text not null check (action in ('ADD', 'DELETE')),
  user_id     uuid references users(id),
  username    text not null,
  created_at  timestamptz not null default now(),
  snapshot    jsonb not null             -- reading data at time of action
);

-- ============================================================
-- ROW LEVEL SECURITY
-- App uses PIN-based auth (not Supabase Auth), so we allow
-- all operations via the anon key and enforce access in the app.
-- ============================================================

alter table users    enable row level security;
alter table cycles   enable row level security;
alter table houses   enable row level security;
alter table rooms    enable row level security;
alter table readings enable row level security;
alter table logs     enable row level security;

create policy "anon full access" on users    for all using (true) with check (true);
create policy "anon full access" on cycles   for all using (true) with check (true);
create policy "anon full access" on houses   for all using (true) with check (true);
create policy "anon full access" on rooms    for all using (true) with check (true);
create policy "anon full access" on readings for all using (true) with check (true);
create policy "anon full access" on logs     for all using (true) with check (true);

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists readings_room_cycle on readings(room_id, cycle_id);
create index if not exists readings_cycle      on readings(cycle_id);
create index if not exists logs_room           on logs(room_id);
create index if not exists logs_created_at     on logs(created_at desc);
create index if not exists rooms_house_id      on rooms(house_id);

-- ============================================================
-- SEED: Houses
-- ============================================================

insert into houses (id) values
  ('A0'), ('A1'), ('A2'), ('A3'), ('A4'), ('A5'), ('A6')
on conflict do nothing;

-- ============================================================
-- SEED: Rooms (73 total)
-- ============================================================

insert into rooms (id, house_id) values
  -- A0: 6 rooms
  ('A0-01','A0'),('A0-02','A0'),('A0-03','A0'),('A0-04','A0'),('A0-05','A0'),('A0-06','A0'),
  -- A1: 12 rooms
  ('A1-01','A1'),('A1-02','A1'),('A1-03','A1'),('A1-04','A1'),('A1-05','A1'),('A1-06','A1'),
  ('A1-07','A1'),('A1-08','A1'),('A1-09','A1'),('A1-10','A1'),('A1-11','A1'),('A1-12','A1'),
  -- A2: 5 rooms
  ('A2-01','A2'),('A2-02','A2'),('A2-03','A2'),('A2-04','A2'),('A2-05','A2'),
  -- A3: 13 rooms
  ('A3-01','A3'),('A3-02','A3'),('A3-03','A3'),('A3-04','A3'),('A3-05','A3'),('A3-06','A3'),
  ('A3-07','A3'),('A3-08','A3'),('A3-09','A3'),('A3-10','A3'),('A3-11','A3'),('A3-12','A3'),
  ('A3-13','A3'),
  -- A4: 9 rooms
  ('A4-01','A4'),('A4-02','A4'),('A4-03','A4'),('A4-04','A4'),('A4-05','A4'),('A4-06','A4'),
  ('A4-07','A4'),('A4-08','A4'),('A4-09','A4'),
  -- A5: 14 rooms
  ('A5-01','A5'),('A5-02','A5'),('A5-03','A5'),('A5-04','A5'),('A5-05','A5'),('A5-06','A5'),
  ('A5-07','A5'),('A5-08','A5'),('A5-09','A5'),('A5-10','A5'),('A5-11','A5'),('A5-12','A5'),
  ('A5-13','A5'),('A5-14','A5'),
  -- A6: 14 rooms
  ('A6-01','A6'),('A6-02','A6'),('A6-03','A6'),('A6-04','A6'),('A6-05','A6'),('A6-06','A6'),
  ('A6-07','A6'),('A6-08','A6'),('A6-09','A6'),('A6-10','A6'),('A6-11','A6'),('A6-12','A6'),
  ('A6-13','A6'),('A6-14','A6')
on conflict do nothing;

-- ============================================================
-- SEED: First admin user (change PIN and name before going live)
-- ============================================================

insert into users (pin, display_name, role) values
  ('0000', 'Admin', 'admin')
on conflict do nothing;

-- ============================================================
-- SEED: First active cycle
-- ============================================================

insert into cycles (id, status) values
  ('2026-03', 'active')
on conflict do nothing;
