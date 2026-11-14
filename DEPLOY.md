# Deploying changes

How changes reach the live app. Production uses one Supabase project, **`yranutsmetnljrxqfwoo`** (`https://yranutsmetnljrxqfwoo.supabase.co`), and the app is hosted on Vercel. Local development (`npm run dev` with `.env.local`) uses the **same** Supabase project, so database and function changes affect the live app straight away.

A change can touch three places. Deploy whichever ones changed, **in this order**:

| What changed      | Where it lives                         | How to deploy                             |
| ----------------- | -------------------------------------- | ----------------------------------------- |
| 1. Database       | `supabase/migrations/*.sql`            | Supabase **SQL Editor** (below)           |
| 2. Edge Functions | `supabase/functions/**`                | `npx supabase functions deploy …` (below) |
| 3. The app        | everything else (`src/`, `public/`, …) | commit and push; Vercel builds it         |

The database goes first so the new app never meets an old database.

## 1. Database migrations (SQL Editor)

For each **new** file in `supabase/migrations/`, oldest first (the file names start with the date):

1. Supabase dashboard → **SQL Editor** → **+** (a **new** query, never one with an earlier migration in it).
2. Paste the whole file and click **Run**.
3. Success is “Success. No rows returned”, or a single result row (e.g. `create_secret`) for files that create a secret.
4. Add the file to the log at the bottom of this page.

Never run a migration twice: it fails (tables already exist), and nothing changes. Migrations are applied by hand, so `npx supabase db push` doesn’t know about them; don’t use it without first marking the applied ones (`npx supabase migration repair --status applied <version>`).

## 2. Edge Functions (terminal)

Run in the VS Code terminal, in the project folder. One-time setup on a computer:

```bash
npx supabase login                                   # browser login; paste the code it shows
npx supabase link --project-ref yranutsmetnljrxqfwoo # asks for the database password
```

Then deploy whichever function changed. Anything in `supabase/functions/_shared/` is used by **both**, so deploy both:

```bash
npx supabase functions deploy send-invoice --use-api
npx supabase functions deploy send-reminders --use-api --no-verify-jwt
```

- `--use-api`: Supabase packages the function itself (no Docker needed).
- `--no-verify-jwt` (send-reminders only): the daily job calls it without a login; it checks its own key instead.

Check under **Edge Functions** in the dashboard (each function’s **Logs** show errors). No secrets go into the code or into Vercel: mailbox passwords are in Supabase Vault, entered in the app.

## 3. The app (Vercel)

Commit and push. Vercel builds and deploys. Its environment variables don’t change for these features:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_DATA_BACKEND=supabase`

## One-time setup already done

- First Admin set (`public.employees.role = 'admin'`).
- Daily reminders job: `select public.schedule_daily_reminders('https://yranutsmetnljrxqfwoo.supabase.co');` — runs at 12:00 SAST; see **Integrations → Cron**. Only re-run it if the job is deleted (running it again just replaces the schedule).
- Mail settings (Afrihost mailbox, port 465) entered per super business in the app.

## Migration log (production)

| Migration                                                          | Applied                               |
| ------------------------------------------------------------------ | ------------------------------------- |
| `20261105120000_invoicing_schema.sql` … `20261113150000_email.sql` | ✅ before 2026-11-14                  |
| `20261114120000_mail_settings.sql`                                 | ✅ 2026-11-14                         |
| `20261114130000_reminders.sql`                                     | ✅ 2026-11-14 (+ daily job scheduled) |
| `20261114140000_reminder_rules.sql`                                | ✅ 2026-11-14                         |

Functions last deployed: `send-invoice` and `send-reminders` on 2026-11-14.
