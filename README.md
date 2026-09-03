# Attendance Scanner

QR-code attendance scanner built with Expo + Supabase. Runs on Android and
iPhone via the **Expo Go** app — no app store submission, no Apple Developer
account required.

## What's included

- **Scan screen** — camera QR scanning, works offline (queues scans locally
  in SQLite and syncs when connectivity returns), shows duplicate check-ins
  instantly.
- **History screen** — live scan feed via Supabase Realtime, updates across
  all operator devices as check-ins happen, shows a running total.
- **Auth** — each operator signs in with their own Supabase Auth account,
  scoped to one event via Row Level Security.
- **Duplicate-proof by design** — a database unique constraint on
  `(event_id, participant_id)` is the real safeguard against double
  check-ins when 20-30 people are scanning at once, not client-side logic.

## 1. Connect to your existing Supabase database

This app was adapted to plug into your existing database rather than
create a new one. Follow `supabase/seed.md` — it runs one additive schema
file (`supabase/schema.sql`) that adds two new tables
(`scanner_profiles`, `attendance_logs`) without touching your existing
`participants`, `email_otps`, or `sponsors` tables, then walks through
creating your 20-30 scanner operator accounts.

## 2. Configure the app

In your Supabase project, go to **Project Settings > API** to get your
Project URL and `anon` public key. Then:

```bash
cp .env.example .env
```

Fill in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `.env`.

## 3. Install and run

```bash
npm install
npx expo start
```

Scan the QR code shown in the terminal with the **Expo Go** app (iOS) or the
Expo Go app's built-in scanner (Android) to load it on a phone. For your
20-30 operators on event day, either:

- Have each of them scan the same terminal QR while on the same network, or
- Publish it so anyone with the link can load it from anywhere:

```bash
npx eas update --branch production
```

(requires a free Expo account — `npx eas login` first). This is the more
reliable option for a live event since it doesn't depend on everyone being
on the same wifi as your laptop.

## Notes on scale

- **1,000 participants, 20-30 concurrent scanners, 1-hour window**: this is
  light load for Postgres — nothing here needs special tuning. The engineering
  effort goes into duplicate prevention (DB constraint) and offline
  resilience (local SQLite queue), not raw throughput.
- The participant roster is synced to each device's local SQLite on login,
  so scanning and duplicate-checking still work even with zero connectivity
  at the venue. Only the final sync-to-server needs a network connection.
