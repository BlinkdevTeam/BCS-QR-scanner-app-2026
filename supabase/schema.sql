-- Attendance Scanner: additive schema
-- Safe to run on your existing database. Does NOT modify, rename, or drop
-- anything in participants, email_otps, or sponsors.
--
-- Assumption: participants.ticket_token (uuid) is the value encoded in each
-- participant's QR code. If your QR codes actually encode something else
-- (e.g. a URL containing the token, or a different field), tell me and
-- I'll adjust the lookup logic in lib/participants.ts instead of this schema.

-- ---------------------------------------------------------------------------
-- New tables
-- ---------------------------------------------------------------------------

-- One row per scanner-operator account. `id` matches auth.users.id, so each
-- operator signs in with their own Supabase Auth email/password.
create table if not exists scanner_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists attendance_logs (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  scanned_by uuid not null references scanner_profiles(id),
  scanned_at timestamptz not null default now(),
  device_id text,
  -- This is what makes concurrent scanning across 20-30 devices safe:
  -- whichever insert lands first wins, the second fails cleanly and the
  -- app shows "already checked in" instead of logging a duplicate.
  unique (participant_id)
);

create index if not exists idx_attendance_logs_scanned_at on attendance_logs(scanned_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- These are ADDITIVE policies. If participants already has RLS enabled with
-- its own policies (e.g. for public registration), this adds a further
-- permissive policy for scanner accounts on top — it does not replace or
-- restrict what's already there.

alter table scanner_profiles enable row level security;
alter table attendance_logs enable row level security;

create policy "scanners can read their own profile"
  on scanner_profiles for select
  using (id = auth.uid());

create policy "scanners can read attendance logs"
  on attendance_logs for select
  using (exists (select 1 from scanner_profiles where id = auth.uid()));

create policy "scanners can insert attendance logs"
  on attendance_logs for insert
  with check (
    exists (select 1 from scanner_profiles where id = auth.uid())
    and scanned_by = auth.uid()
  );

-- If participants doesn't already have RLS enabled, scanner accounts can
-- read it via Supabase's default (RLS off = readable). If it DOES have RLS
-- enabled already, uncomment this so scanner accounts can look participants
-- up by ticket_token:
--
-- create policy "scanners can read participants"
--   on participants for select
--   using (exists (select 1 from scanner_profiles where id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- Enables the History screen to update live across devices as check-ins
-- happen. Dashboard: Database > Replication > toggle "attendance_logs" on.
-- Or run:
alter publication supabase_realtime add table attendance_logs;
