-- Emailing invoices (super businesses), through the send-invoice Edge
-- Function and Resend.
--
--   * Each business has a "Send invoices from" address on a domain verified in
--     Resend (e.g. info@africonnectsolutions.co.za).
--   * The PDF of an issued invoice is saved once (private bucket, never
--     overwritten), so every email attaches exactly what was issued.
--   * Every send attempt is logged. Only the Edge Function (service role)
--     writes the log; employees read it for businesses they can see.
begin;

alter table public.businesses
  add column email_from text not null default ''
    constraint businesses_email_from check (
      email_from = '' or email_from ~* '^[^[:space:]@<>(),;:"]+@[^[:space:]@<>(),;:"]+\.[a-z]{2,}$'
    );

create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id),
  business_id uuid not null references public.businesses (id),
  kind text not null default 'invoice'
    constraint email_log_kind check (kind in ('invoice', 'reminder')),
  recipients text[] not null,
  cc text[] not null default '{}',
  subject text not null,
  status text not null constraint email_log_status check (status in ('sent', 'failed')),
  provider_id text,
  error text not null default '',
  sent_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index email_log_document_idx on public.email_log (document_id);
alter table public.email_log enable row level security;
create policy "Employees read visible email log" on public.email_log
  for select to authenticated using ((select public.can_see_business(business_id)));
grant select on table public.email_log to authenticated;

-- ───────────────────────────── Saved invoice PDFs ─────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoice-pdfs', 'invoice-pdfs', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- "<business id>/<document id>.pdf" for an issued invoice the caller can see.
create function public.invoice_pdf_path_ok(path text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  biz uuid;
  doc uuid;
begin
  if path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$' then return false; end if;
  biz := split_part(path, '/', 1)::uuid;
  doc := replace(split_part(path, '/', 2), '.pdf', '')::uuid;
  return public.can_see_business(biz) and exists (
    select 1 from public.documents d
    where d.id = doc and d.business_id = biz
      and d.kind = 'invoice' and d.status = 'issued'
  );
exception when invalid_text_representation then
  return false;
end;
$$;
revoke execute on function public.invoice_pdf_path_ok(text) from public, anon;
grant execute on function public.invoice_pdf_path_ok(text) to authenticated;

-- Employees save PDFs of issued invoices and read them back; nobody can
-- replace or delete one (no update or delete policy).
create policy "Employees save issued invoice PDFs" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'invoice-pdfs' and (select public.invoice_pdf_path_ok(name)));
create policy "Employees read invoice PDFs" on storage.objects
  for select to authenticated
  using (bucket_id = 'invoice-pdfs' and (select public.invoice_pdf_path_ok(name)));

commit;
