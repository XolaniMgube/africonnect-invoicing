-- Automatic reminder rules (super businesses, Admins only).
--
--   * Per business: on/off and the days relative to an invoice's due date to
--     remind on (e.g. 0 = on the due date, 7 = a week after, -3 = 3 days
--     before). Default: on the due date, 7 and 14 days after.
--   * The 12:00 daily run (send-reminders) sends, for every unpaid issued
--     invoice of such a business, the rule whose day has arrived — at most once
--     per rule and invoice (a missed day is caught up within 3 days).
--   * Admins can pause automatic reminders for one invoice.
--   * Automatic reminders are recorded in public.reminders (rule_offset set),
--     so they show on the invoice next to manual ones.
begin;

alter table public.businesses
  add column auto_reminders boolean not null default false,
  add column reminder_offsets integer[] not null default '{0,7,14}'
    constraint businesses_reminder_offsets check (
      cardinality(reminder_offsets) between 1 and 8
      and -30 <= all (reminder_offsets) and 365 >= all (reminder_offsets)
    );

-- Only Admins change the rules (SQL Editor / server sessions are allowed).
create function public.guard_reminder_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.auto_reminders)
     or (tg_op = 'UPDATE' and (
       new.auto_reminders is distinct from old.auto_reminders
       or new.reminder_offsets is distinct from old.reminder_offsets)) then
    if (select auth.uid()) is not null and not public.is_admin() then
      raise exception 'Only an admin can change automatic reminders.';
    end if;
  end if;
  return new;
end;
$$;
create trigger businesses_guard_reminder_rules before insert or update on public.businesses
  for each row execute function public.guard_reminder_rules();

alter table public.invoice_tracking
  add column auto_reminders_paused boolean not null default false;

-- Only Admins pause or resume an invoice's automatic reminders.
create function public.guard_reminder_pause()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (case when tg_op = 'INSERT' then new.auto_reminders_paused
           else new.auto_reminders_paused is distinct from old.auto_reminders_paused end)
     and (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Only an admin can pause automatic reminders.';
  end if;
  return new;
end;
$$;
create trigger invoice_tracking_guard_pause before insert or update on public.invoice_tracking
  for each row execute function public.guard_reminder_pause();

-- Which rule an automatic reminder came from; one per rule and invoice.
alter table public.reminders add column rule_offset integer;
create unique index reminders_rule_once
  on public.reminders (document_id, rule_offset) where rule_offset is not null;

-- Only the daily run creates automatic reminders: from the app it's manual.
create function public.manual_reminder_from_app()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.rule_offset := null;
  end if;
  return new;
end;
$$;
create trigger reminders_manual_from_app before insert on public.reminders
  for each row execute function public.manual_reminder_from_app();

commit;
