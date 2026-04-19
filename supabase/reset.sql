-- ================================================================
-- VTPT Meter — Full Database Reset
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- PRESERVES : users, cycles, readings, logs
-- RESETS    : table structure, RLS, policies, indexes
-- RE-SEEDS  : houses (7 rows), rooms (73 rows)
-- ================================================================

begin;

-- ============================================================
-- 1. Save real data into temp tables
-- ============================================================

create temp table _save_users    as select * from users;
create temp table _save_cycles   as select * from cycles;
create temp table _save_readings as select * from readings;
create temp table _save_logs     as select * from logs;

-- ============================================================
-- 2. Drop all tables (reverse dependency order)
-- ============================================================

drop table if exists logs     cascade;
drop table if exists readings cascade;
drop table if exists rooms    cascade;
drop table if exists houses   cascade;
drop table if exists cycles   cascade;
drop table if exists users    cascade;

-- ============================================================
-- 3. Recreate tables (correct dependency order)
-- ============================================================

create table users (
  id           uuid        primary key default gen_random_uuid(),
  pin          text        not null unique,
  display_name text        not null,
  role         text        not null default 'user' check (role in ('user', 'admin')),
  created_at   timestamptz not null default now()
);

create table cycles (
  id         text        primary key,
  status     text        not null default 'active' check (status in ('active', 'closed')),
  created_by uuid        references users(id),
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz
);

create table houses (
  id text primary key
);

create table rooms (
  id       text primary key,
  house_id text not null references houses(id)
);

create table readings (
  id          bigint      primary key generated always as identity,
  room_id     text        not null references rooms(id),
  cycle_id    text        not null references cycles(id),
  recorded_at date        not null,
  dien        numeric,
  nuoc        numeric,
  notes       text,
  created_by  uuid        references users(id),
  created_at  timestamptz not null default now()
);

create table logs (
  id         bigint      primary key generated always as identity,
  room_id    text        not null references rooms(id),
  action     text        not null check (action in ('ADD', 'DELETE')),
  user_id    uuid        references users(id),
  username   text        not null,
  created_at timestamptz not null default now(),
  snapshot   jsonb       not null
);

-- ============================================================
-- 4. Enable RLS on all tables
-- ============================================================

alter table users    enable row level security;
alter table cycles   enable row level security;
alter table houses   enable row level security;
alter table rooms    enable row level security;
alter table readings enable row level security;
alter table logs     enable row level security;

-- ============================================================
-- 5. Policies — allow anon key full access
--    (app uses PIN auth, not Supabase Auth)
-- ============================================================

create policy "anon full access" on users    for all using (true) with check (true);
create policy "anon full access" on cycles   for all using (true) with check (true);
create policy "anon full access" on houses   for all using (true) with check (true);
create policy "anon full access" on rooms    for all using (true) with check (true);
create policy "anon full access" on readings for all using (true) with check (true);
create policy "anon full access" on logs     for all using (true) with check (true);

-- ============================================================
-- 6. Indexes
-- ============================================================

create index readings_room_cycle on readings(room_id, cycle_id);
create index readings_cycle      on readings(cycle_id);
create index logs_room           on logs(room_id);
create index logs_created_at     on logs(created_at desc);
create index rooms_house_id      on rooms(house_id);

-- ============================================================
-- 7. Re-seed houses
-- ============================================================

insert into houses (id) values
  ('A0'), ('A1'), ('A2'), ('A3'), ('A4'), ('A5'), ('A6');

-- ============================================================
-- 8. Re-seed rooms (73 total)
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
  ('A6-13','A6'),('A6-14','A6');

-- ============================================================
-- 9. Restore users
-- ============================================================

insert into users (id, pin, display_name, role, created_at)
select id, pin, display_name, role, created_at
from _save_users;

-- ============================================================
-- 10. Restore cycles (after users, to satisfy created_by FK)
-- ============================================================

insert into cycles (id, status, created_by, opened_at, closed_at)
select id, status, created_by, opened_at, closed_at
from _save_cycles;

-- ============================================================
-- 11. Restore readings — preserve original IDs
-- ============================================================

insert into readings (id, room_id, cycle_id, recorded_at, dien, nuoc, notes, created_by, created_at)
overriding system value
select id, room_id, cycle_id, recorded_at, dien, nuoc, notes, created_by, created_at
from _save_readings;

-- Advance identity sequence past the max restored ID
select setval(
  pg_get_serial_sequence('readings', 'id'),
  coalesce((select max(id) from readings), 1)
);

-- ============================================================
-- 12. Restore logs — preserve original IDs
-- ============================================================

insert into logs (id, room_id, action, user_id, username, created_at, snapshot)
overriding system value
select id, room_id, action, user_id, username, created_at, snapshot
from _save_logs;

select setval(
  pg_get_serial_sequence('logs', 'id'),
  coalesce((select max(id) from logs), 1)
);

-- ============================================================
-- 13. Drop temp tables
-- ============================================================

drop table _save_users;
drop table _save_cycles;
drop table _save_readings;
drop table _save_logs;

commit;

-- ============================================================
-- VERIFY — run this after commit to confirm expected counts
-- ============================================================

select tbl, rows from (
  select 1 as ord, 'houses'   as tbl, count(*)::text as rows from houses
  union all
  select 2,        'rooms',           count(*)::text          from rooms
  union all
  select 3,        'users',           count(*)::text          from users
  union all
  select 4,        'cycles',          count(*)::text          from cycles
  union all
  select 5,        'readings',        count(*)::text          from readings
  union all
  select 6,        'logs',            count(*)::text          from logs
) t order by ord;
