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

## 5. Email setup and “Send invoice” — L (super businesses) ⏸ paused: switching to Afrihost (decision pending your “go”)

Built (2026-11-13, uncommitted, not yet deployed):

- [x] **Send invoice** on issued invoices of super businesses (To, CC, subject, message; PDF attached) and an email history per invoice.
- [x] PDF saved when an invoice is issued (private `invoice-pdfs` bucket); per-business **Send invoices from** setting.
- [x] `send-invoice` Supabase Edge Function, currently sending through **Resend**. Migration `20261113150000_email.sql`.

**Where we stopped:** you’d rather not use Resend. Both domains’ mailboxes are on **Afrihost cPanel** (info@africonnectsolutions.co.za; Lumina Cube on luminacube.co.za). Proposed change, waiting for your “go”:

- [ ] Per-business mail settings (Admin only): server (e.g. `mail.africonnectsolutions.co.za`), port 465 (SSL), mailbox address, password. Find them in cPanel → Email Accounts → Connect Devices.
- [ ] Password stored encrypted in Supabase Vault; only the send function can read it.
- [ ] Admin **Send test email** button: proves whether Supabase can reach Afrihost (Supabase may block mail ports 25/587; 465 usually works — must be tested).
- [ ] Function sends through the Afrihost mailbox (SMTP) instead of Resend; Resend kept only as an optional fallback.
- [ ] **You:** check cPanel → Email Deliverability shows both domains as valid; have the mailbox passwords ready.

## 6. Scheduled reminders — L (super businesses)

- [ ] Schedule reminders per invoice: date, recipient, message.
- [ ] Daily job (Supabase pg_cron + Edge Function, 08:00 SAST) sends what’s due.
- [ ] Reminder shows the balance due, with a balance statement (same invoice number).
- [ ] Reminders cancel themselves when the invoice is paid; failures are logged.
- [ ] **Check:** Supabase plan. Free projects can pause when inactive, which would stop reminders.

## 7. Automatic reminder rules — M (super businesses)

- [ ] Per business, e.g. 3 days before due, on the due date, 7 days after.

## Later (optional)

- [ ] Quote status: accepted / declined / expired.
- [ ] Recurring monthly invoices.
- [ ] Customer statements.
- [ ] Credit notes.
