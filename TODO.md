# Roadmap

One feature at a time: build → you test → next. Ordered by what depends on what, then by effort (S / M / L).

## 1. Hide item prices — S (all businesses) ✅ done

- [x] Per-document option “Show item prices” (on by default).
- [x] When off, preview and PDF show Description, Qty, Total only, in both templates.
- [x] Saved with the document; issued documents keep the setting.

## 2. Roles and super businesses — M/L ✅ done

- [x] Roles: **Admin** (users, roles, super businesses) and **Staff** (today’s abilities).
- [x] Admin marks a business as a **super business** (e.g. Africonnect, Lumina Cube).
- [x] Admin chooses who can see each super business; others can’t see it at all.
- [x] Enforced in the database, not only in the app.

## 3. Payments, superseded and cancelled — M (super businesses; superseded: all) ✅ done

- [x] Due date for super businesses: payment period setting, due date shown and editable in the app. Not printed.
- [x] Record payments against an invoice: amount, date, method, reference. Delete to fix mistakes.
- [x] Status: **Unpaid**, **Partially paid**, **Paid**, **Overdue**; balance on the invoice page; list filter.
- [x] One invoice per sale: a partial payment never creates a new invoice.
- [x] **Cancel invoice** / restore (no payments allowed on a cancelled invoice).
- [x] Issuing a revision marks the original **Superseded** (all businesses).

## 4. Receivables overview — S/M (super businesses) ✅ done

- [x] Total outstanding, overdue list, overdue by age (not yet due / 1–30 / 31–60 / 60+ days).
- [x] Owed-by-customer summary; business and customer filters.

## 5. Email setup and “Send invoice” — L (super businesses) ✅ done

- [x] **Send invoice** + email history, PDF saved on issue, per-business **Send invoices from**.
- [x] Each business sends from its own Afrihost mailbox (server, port, mailbox, password encrypted in Vault); **Send test email** (tested ✅ 2026-11-14 via mail.africonnectsolutions.co.za:465 to Gmail inbox).
- [x] **Send invoice** goes through the mailbox; Resend removed.
- [x] Redeployed; real invoice email tested ✅ (2026-11-14).

## 6. Scheduled reminders — L (super businesses, Admins) ✅ built; set up 2026-11-14, first real run 2026-11-15 12:00

- [x] Admins schedule reminders per invoice: date, To, CC, subject, message; cancel; **Send now**.
- [x] Daily job (pg_cron, **12:00 SAST**) → `send-reminders` Edge Function, through the business’s Afrihost mailbox.
- [x] Invoice PDF attached; the balance as it is on the sending day (same invoice number).
- [x] Paying in full or cancelling the invoice cancels scheduled reminders; failures are logged with the reason.
- [ ] **You:** apply `20261114130000_reminders.sql`; deploy `send-reminders` (`--no-verify-jwt`) and redeploy `send-invoice`; run `select public.schedule_daily_reminders('https://yranutsmetnljrxqfwoo.supabase.co');` once (README → Payment reminders).
- [ ] **Check:** Supabase plan. Free projects can pause when inactive, which would stop reminders.

## 7. Automatic reminder rules — M (super businesses, Admins) ✅ built and deployed 2026-11-14

- [x] Per business: on/off and days relative to the due date (default: due date, +7, +14).
- [x] The 12:00 run reminds every unpaid issued invoice on those days, once per day chosen; a missed day is caught up within 3 days.
- [x] Per-invoice **Pause/Resume**; invoices show their plan; customers without email are flagged.
- [x] Migration applied and `send-reminders` redeployed (2026-11-14).

## Later (optional)

- [ ] Quote status: accepted / declined / expired.
- [ ] Recurring monthly invoices.
- [ ] Customer statements.
- [ ] Credit notes.
