-- Scheduled payment reminders (super businesses, Admins only).
--
--   * An Admin schedules a reminder for an issued invoice that still has money
--     owing: a date, recipients, subject and message.
--   * Every day at 12:00 (South African time) a pg_cron job calls the
--     send-reminders Edge Function, which emails the reminders due that day
--     through the business's own mailbox, with the invoice PDF attached and
--     the balance as it is on that day.
--   * Reminders cancel themselves when the invoice is paid in full or
--     cancelled; the function also skips invoices replaced by a revision.
--
-- After applying, run once in the SQL Editor (your project URL):
--   select public.schedule_daily_reminders('https://<project-ref>.supabase.co');
begin;

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- South African calendar date (reminders are dated in local time).
create function public.sa_today()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Africa/Johannesburg')::date $$;

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id),
  business_id uuid not null references public.businesses (id),
  send_on date not null,
  recipients text[] not null
    constraint reminders_recipients check (cardinality(recipients) between 1 and 10),
  cc text[] not null default '{}',
  subject text not null
    constraint reminders_subject check (char_length(btrim(subject)) between 1 and 200),
  message text not null default ''
    constraint reminders_message check (char_length(message) <= 5000),
  status text not null default 'scheduled'
    constraint reminders_status check (status in ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  error text not null default '',
  email_log_id uuid references public.email_log (id),
  sent_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reminders_due_idx on public.reminders (send_on) where status = 'scheduled';
create index reminders_document_idx on public.reminders (document_id);

-- Employees (Admins) may only schedule, and cancel a scheduled reminder. The
-- send-reminders function (service role, no signed-in user) records results.
create function public.prepare_reminder()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  doc public.documents%rowtype;
begin
  -- The rules below are for requests from the app. The send-reminders
  -- function (service_role) and this database's own triggers (owner) record
  -- results freely.
  if current_user not in ('authenticated', 'anon') then
    new.updated_at := now();
    return new;
  end if;
  if not public.is_admin() then
    raise exception 'Only an admin can schedule or cancel reminders.';
  end if;
  if tg_op = 'UPDATE' then
    if old.status <> 'scheduled' or new.status <> 'cancelled' then
      raise exception 'Only a scheduled reminder can be cancelled.';
    end if;
    new.error := 'Cancelled by an admin.';
    new.updated_at := now();
    return new;
  end if;
  doc := public.require_open_invoice(new.document_id);
  if exists (
    select 1 from public.invoice_tracking
    where document_id = doc.id and cancelled_at is not null
  ) then
    raise exception 'This invoice is cancelled.';
  end if;
  if (select coalesce(sum(amount), 0) from public.payments where document_id = doc.id) >= doc.total then
    raise exception 'This invoice is already paid.';
  end if;
  if new.send_on < public.sa_today() then
    raise exception 'Choose today or a later date.';
  end if;
  new.business_id := doc.business_id;
  new.status := 'scheduled';
  new.error := '';
  new.email_log_id := null;
  new.sent_at := null;
  new.created_by := auth.uid();
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;
create trigger reminders_prepare before insert or update on public.reminders
  for each row execute function public.prepare_reminder();

-- Paying an invoice in full, or cancelling it, cancels its scheduled reminders.
create function public.cancel_reminders_when_settled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := new.document_id;
  reason text;
begin
  if tg_table_name = 'payments' then
    if (select coalesce(sum(amount), 0) from public.payments where document_id = target)
       < (select total from public.documents where id = target) then
      return new;
    end if;
    reason := 'Not sent: the invoice was paid.';
  else
    if new.cancelled_at is null then return new; end if;
    reason := 'Not sent: the invoice was cancelled.';
  end if;
  -- Runs as the table owner (security definer), so the admin-only rule in
  -- prepare_reminder doesn't apply: Staff recording a payment is fine.
  update public.reminders
    set status = 'cancelled', error = reason, updated_at = now()
    where document_id = target and status = 'scheduled';
  return new;
end;
$$;
create trigger payments_cancel_reminders after insert on public.payments
  for each row execute function public.cancel_reminders_when_settled();
create trigger tracking_cancel_reminders after insert or update on public.invoice_tracking
  for each row execute function public.cancel_reminders_when_settled();

alter table public.reminders enable row level security;
revoke all on table public.reminders from anon, authenticated;
create policy "Employees read visible reminders" on public.reminders
  for select to authenticated using ((select public.can_see_business(business_id)));
create policy "Admins schedule reminders" on public.reminders
  for insert to authenticated
  with check ((select public.is_admin()) and (select public.can_see_business(business_id)));
create policy "Admins cancel reminders" on public.reminders
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert on table public.reminders to authenticated;
grant update (status) on table public.reminders to authenticated;

-- ───────────────────────────── The daily run ─────────────────────────────

-- A random key only the daily job and the send-reminders function know.
select vault.create_secret(
  replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  'reminders_token',
  'Lets the daily pg_cron job call the send-reminders Edge Function'
);

create function public.reminder_token_ok(token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'reminders_token' and decrypted_secret = token
  );
$$;
revoke execute on function public.reminder_token_ok(text) from public, anon, authenticated;
grant execute on function public.reminder_token_ok(text) to service_role;

-- Run once (SQL Editor) with the project URL. 12:00 SAST = 10:00 UTC.
-- Calling it again replaces the schedule.
create function public.schedule_daily_reminders(project_url text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if project_url !~ '^https://[a-z0-9-]+\.supabase\.co$' then
    raise exception 'Use the project URL, e.g. https://abcd.supabase.co';
  end if;
  return cron.schedule(
    'send-due-reminders',
    '0 10 * * *',
    format(
      $job$select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-reminders-token',
          (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_token')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      )$job$,
      project_url || '/functions/v1/send-reminders'
    )
  );
end;
$$;
revoke execute on function public.schedule_daily_reminders(text) from public, anon, authenticated;

commit;
