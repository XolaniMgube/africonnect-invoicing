-- Payments, due dates and cancelling for issued invoices of super businesses.
-- Invoices themselves stay unchangeable: payments and follow-up details live
-- in their own tables. "Superseded" (an issued revision exists) is worked out
-- from public.documents and needs no storage.
--
--   * A payment belongs to an issued invoice of a super business that is not
--     cancelled or superseded, and can't take it past its total.
--   * A cancelled invoice has no payments; an invoice with payments can't be
--     revised (the payments would stay on the replaced invoice).
--   * Payments can be deleted (to correct mistakes) but not edited.
begin;

-- Throws unless payments and follow-up details may change for this document.
create function public.require_open_invoice(target uuid)
returns public.documents
language plpgsql
set search_path = ''
as $$
declare
  doc public.documents%rowtype;
  biz public.businesses%rowtype;
begin
  select * into doc from public.documents where id = target;
  if not found then raise exception 'This invoice no longer exists.'; end if;
  select * into biz from public.businesses where id = doc.business_id;
  if doc.kind <> 'invoice' or doc.status <> 'issued' or not biz.is_super then
    raise exception 'Payments can be recorded only on issued invoices of super businesses.';
  end if;
  if biz.archived then
    raise exception 'Restore this business before recording changes.';
  end if;
  if exists (
    select 1 from public.documents r
    where r.revision_of_id = doc.id and r.status = 'issued'
  ) then
    raise exception 'This invoice was replaced by a revision.';
  end if;
  return doc;
end;
$$;

-- ───────────────────────────── Due dates and cancelling ─────────────────────────────

create table public.invoice_tracking (
  document_id uuid primary key references public.documents (id),
  business_id uuid not null references public.businesses (id),
  due_date date,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  cancel_reason text not null default ''
    constraint invoice_tracking_reason check (char_length(cancel_reason) <= 500),
  updated_at timestamptz not null default now()
);

create function public.prepare_invoice_tracking()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  doc public.documents%rowtype;
begin
  doc := public.require_open_invoice(new.document_id);
  new.business_id := doc.business_id;
  if new.due_date is not null and new.due_date < doc.document_date then
    raise exception 'The due date can’t be before the invoice date.';
  end if;
  if new.cancelled_at is not null
     and (tg_op = 'INSERT' or old.cancelled_at is null) then
    if exists (select 1 from public.payments where document_id = doc.id) then
      raise exception 'This invoice has payments recorded. Delete them before cancelling it.';
    end if;
    new.cancelled_at := now();
    new.cancelled_by := auth.uid();
  elsif new.cancelled_at is null then
    new.cancelled_by := null;
    new.cancel_reason := '';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ───────────────────────────── Payments ─────────────────────────────

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id),
  business_id uuid not null references public.businesses (id),
  amount numeric not null
    constraint payments_amount check (amount > 0 and amount = round(amount, 2)),
  paid_on date not null,
  method text not null
    constraint payments_method check (method in ('eft', 'cash', 'card', 'other')),
  reference text not null default ''
    constraint payments_reference check (char_length(reference) <= 200),
  recorded_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index payments_document_idx on public.payments (document_id);

create trigger invoice_tracking_prepare before insert or update on public.invoice_tracking
  for each row execute function public.prepare_invoice_tracking();

create function public.prepare_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  doc public.documents%rowtype;
  paid numeric;
begin
  doc := public.require_open_invoice(new.document_id);
  -- One payment at a time per invoice, so two can't overpay it together.
  perform pg_advisory_xact_lock(hashtextextended('payment:' || doc.id::text, 0));
  if exists (
    select 1 from public.invoice_tracking
    where document_id = doc.id and cancelled_at is not null
  ) then
    raise exception 'Restore this invoice before recording a payment.';
  end if;
  select coalesce(sum(amount), 0) into paid
    from public.payments where document_id = doc.id;
  if paid + new.amount > doc.total then
    raise exception 'The payment is more than the balance due.';
  end if;
  new.business_id := doc.business_id;
  new.recorded_by := auth.uid();
  new.created_at := now();
  return new;
end;
$$;
create trigger payments_prepare before insert on public.payments
  for each row execute function public.prepare_payment();

create function public.guard_payment_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.businesses where id = old.business_id and archived
  ) then
    raise exception 'Restore this business before recording changes.';
  end if;
  return old;
end;
$$;
create trigger payments_guard_delete before delete on public.payments
  for each row execute function public.guard_payment_delete();

-- An invoice with payments can't be revised.
create function public.guard_revision_payments()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.revision_of_id is not null and exists (
    select 1 from public.payments where document_id = new.revision_of_id
  ) then
    raise exception 'This invoice has payments recorded. Delete them before editing it.';
  end if;
  return new;
end;
$$;
create trigger documents_guard_revision_payments before insert on public.documents
  for each row execute function public.guard_revision_payments();

-- ───────────────────────────── Access ─────────────────────────────

alter table public.invoice_tracking enable row level security;
alter table public.payments enable row level security;

create policy "Employees read visible tracking" on public.invoice_tracking
  for select to authenticated using ((select public.can_see_business(business_id)));
create policy "Employees add visible tracking" on public.invoice_tracking
  for insert to authenticated with check ((select public.can_see_business(business_id)));
create policy "Employees update visible tracking" on public.invoice_tracking
  for update to authenticated
  using ((select public.can_see_business(business_id)))
  with check ((select public.can_see_business(business_id)));

create policy "Employees read visible payments" on public.payments
  for select to authenticated using ((select public.can_see_business(business_id)));
create policy "Employees add visible payments" on public.payments
  for insert to authenticated with check ((select public.can_see_business(business_id)));
create policy "Employees delete visible payments" on public.payments
  for delete to authenticated using ((select public.can_see_business(business_id)));

grant select, insert, update on table public.invoice_tracking to authenticated;
grant select, insert, delete on table public.payments to authenticated;

commit;
