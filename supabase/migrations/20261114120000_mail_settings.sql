-- Sending invoices through each super business's own mailbox (e.g. the
-- Afrihost cPanel account for info@africonnectsolutions.co.za) instead of a
-- third-party email service.
--
--   * Admins save the mailbox's server, port and login per super business.
--   * The password goes into Supabase Vault (encrypted). Nobody can read it
--     back through the API; only the send-invoice Edge Function (service
--     role) can, through mail_settings_for_send().
begin;

create extension if not exists supabase_vault with schema vault;

create table public.mail_settings (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  host text not null
    constraint mail_settings_host check (host ~ '^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  port integer not null default 465
    constraint mail_settings_port check (port in (465, 587, 2525)),
  username text not null
    constraint mail_settings_username check (char_length(btrim(username)) between 1 and 200),
  password_secret uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null
);
alter table public.mail_settings enable row level security;
-- Supabase grants new tables to everyone by default; narrow it.
revoke all on table public.mail_settings from anon, authenticated;
-- Admins see whether a business has settings (never the password itself).
create policy "Admins read mail settings" on public.mail_settings
  for select to authenticated using ((select public.is_admin()));
grant select (business_id, host, port, username, updated_at)
  on table public.mail_settings to authenticated;

-- Admin only. An empty password keeps the saved one.
create function public.set_mail_settings(
  target uuid, mail_host text, mail_port integer, mail_username text, mail_password text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_secret uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change mail settings.';
  end if;
  if not exists (select 1 from public.businesses where id = target and is_super) then
    raise exception 'Mail settings are for super businesses.';
  end if;
  select password_secret into current_secret
    from public.mail_settings where business_id = target;
  if coalesce(mail_password, '') <> '' then
    if current_secret is null then
      current_secret := vault.create_secret(
        mail_password, 'mail-password-' || target::text, 'Mailbox password for invoice emails'
      );
    else
      perform vault.update_secret(current_secret, mail_password);
    end if;
  elsif current_secret is null then
    raise exception 'Enter the mailbox password.';
  end if;
  insert into public.mail_settings (business_id, host, port, username, password_secret, updated_at, updated_by)
  values (target, lower(btrim(mail_host)), mail_port, btrim(mail_username), current_secret, now(), auth.uid())
  on conflict (business_id) do update set
    host = excluded.host,
    port = excluded.port,
    username = excluded.username,
    password_secret = excluded.password_secret,
    updated_at = now(),
    updated_by = auth.uid();
end;
$$;
revoke execute on function public.set_mail_settings(uuid, text, integer, text, text) from public, anon;
grant execute on function public.set_mail_settings(uuid, text, integer, text, text) to authenticated;

-- For the send-invoice Edge Function only (service role).
create function public.mail_settings_for_send(target uuid)
returns table (host text, port integer, username text, password text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.host, m.port, m.username, s.decrypted_secret
  from public.mail_settings m
  join vault.decrypted_secrets s on s.id = m.password_secret
  where m.business_id = target;
$$;
revoke execute on function public.mail_settings_for_send(uuid) from public, anon, authenticated;
grant execute on function public.mail_settings_for_send(uuid) to service_role;

-- ───────────────────────────── Tighter table privileges ─────────────────────────────
-- Tables added since the first migration received Supabase's default grants
-- (everything, even for signed-out visitors). Row-level security already
-- refused those requests; this narrows the privileges to what the app uses,
-- like the original tables, so a missing policy is never the only safeguard.
revoke all on table
  public.business_access, public.payments, public.invoice_tracking, public.email_log
  from anon, authenticated;
grant select, insert, delete on table public.business_access to authenticated;
grant select, insert, delete on table public.payments to authenticated;
grant select, insert, update on table public.invoice_tracking to authenticated;
grant select on table public.email_log to authenticated;
revoke execute on function public.require_open_invoice(uuid) from public, anon;
grant execute on function public.require_open_invoice(uuid) to authenticated;

commit;
