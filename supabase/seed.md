# Connecting to your existing database

This app was rebuilt to plug into your existing Supabase database, not
replace it. It only adds two new tables (`scanner_profiles`,
`attendance_logs`) — nothing in `participants`, `email_otps`, or `sponsors`
is touched.

## 1. Run the additive schema

Open the SQL editor in Supabase and run `supabase/schema.sql`. Read the
comments at the top first — one section is commented out on purpose (a
participants RLS policy) in case you already have RLS enabled on that table
with your own policies; enable it only if scanner accounts get blocked from
reading participants.

## 2. Confirm the QR assumption

The app assumes each participant's printed/emailed QR code encodes their
`ticket_token` (uuid) value as plain text. If your QR codes actually encode
something else — a URL, a different field, a compound string — tell me and
I'll adjust `lib/participants.ts` to match instead of changing your data.

## 3. Create scanner operator accounts (20-30 people)

In the Supabase dashboard: **Authentication > Users > Add user**, one per
operator, with an email + password.

Then link each account as a scanner:

```sql
insert into scanner_profiles (id, display_name) values
  ('paste-auth-user-uuid-here', 'Operator Name');
```

Repeat per operator.

## 4. Participants

No import needed — the app reads directly from your existing `participants`
table. Just make sure every row that should be scannable already has a
`ticket_token` value.
