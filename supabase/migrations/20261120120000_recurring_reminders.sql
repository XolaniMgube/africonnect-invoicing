-- Repeating reminders (Admins, super businesses).
--
-- A reminder an Admin schedules can repeat every N days or every N working
-- days (weekends and South African public holidays skipped), optionally until
-- a date. After each one is sent, the send-reminders function schedules the
-- next (same series_id). The series stops by itself when the invoice is paid,
-- cancelled or replaced, after the end date, or when an Admin cancels the
-- next scheduled one.
begin;

alter table public.reminders
  add column repeat_kind text not null default 'none'
    constraint reminders_repeat_kind check (repeat_kind in ('none', 'days', 'working_days')),
  add column repeat_every integer,
  add column repeat_until date,
  add column series_id uuid,
  add constraint reminders_repeat_every check (
    (repeat_kind = 'none' and repeat_every is null)
    or (repeat_kind <> 'none' and repeat_every between 1 and 30)
  ),
  add constraint reminders_repeat_until check (
    repeat_until is null or (repeat_kind <> 'none' and repeat_until >= send_on)
  );
create index reminders_series_idx on public.reminders (series_id);

-- From the app, a reminder is always manual and starts its own series; only
-- the daily run (service role) creates automatic ones and later occurrences.
create or replace function public.manual_reminder_from_app()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.rule_offset := null;
    new.series_id := null;
  end if;
  return new;
end;
$$;

commit;
