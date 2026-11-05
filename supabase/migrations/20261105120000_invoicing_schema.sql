-- Africonnect Invoicing — database schema.
--
-- Apply once to a new Supabase project, either with `npx supabase db push`
-- or by pasting this file into Dashboard → SQL Editor and running it.
--
-- Rules enforced here (not only in the browser), so they hold for every
-- employee and every device:
--   * only users listed in public.employees can read or change any record;
--   * nothing can be deleted through the API (archive instead);
--   * invoice and quotation numbers are assigned by the database, one at a
--     time per business and document type, so they never collide;
--   * issued documents are read-only;
--   * a quotation converts into at most one invoice;
--   * archived businesses accept no new or changed customers, items or
--     documents.

-- ───────────────────────────── Employees ─────────────────────────────

create table public.employees (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

comment on table public.employees is
  'Africonnect staff allowed to use the invoicing app. Creating an Auth user is not enough: add a row here too.';

alter table public.employees enable row level security;

create function public.is_employee()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employees where user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_employee() from public, anon;
grant execute on function public.is_employee() to authenticated;

create policy "Employees read their own record"
  on public.employees for select to authenticated
  using (user_id = (select auth.uid()));

-- ───────────────────────────── Helpers ─────────────────────────────

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ───────────────────────────── Client businesses ─────────────────────────────

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  industry text not null default '',
  email text not null check (btrim(email) <> ''),
  phone text not null default '',
  address text not null check (btrim(address) <> ''),
  registration text not null default '',
  vat text not null default '',
  bank text not null default '',
  account_name text not null default '',
  account_number text not null default '',
  branch text not null default '',
  logo text not null default '',
  accent text not null default '#286044' check (accent ~* '^#[0-9a-f]{6}$'),
  invoice_prefix text not null
    check (invoice_prefix ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,11}$'),
  quotation_prefix text not null
    check (quotation_prefix ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,11}$'),
  payment_days integer not null default 30 check (payment_days between 0 and 365),
  validity_days integer not null default 14 check (validity_days between 0 and 365),
  notes text not null default '',
  tax_rate numeric not null default 0 check (tax_rate between 0 and 100),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint businesses_distinct_prefixes
    check (upper(invoice_prefix) <> upper(quotation_prefix)),
  constraint businesses_vat_number_for_vat
    check (tax_rate = 0 or btrim(vat) <> '')
);

create trigger businesses_touch before update on public.businesses
  for each row execute function public.touch_updated_at();

-- Customers and items belong to one business and can only change while that
-- business is active.
create function public.guard_business_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.business_id <> old.business_id then
    raise exception 'Cannot move a record between businesses.';
  end if;
  if exists (
    select 1 from public.businesses
    where id = new.business_id and archived
  ) then
    raise exception 'Restore this business before editing its records.';
  end if;
  return new;
end;
$$;

-- ───────────────────────────── Customers ─────────────────────────────

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  name text not null check (btrim(name) <> ''),
  contact text not null default '',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  registration text not null default '',
  vat text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Lets documents require that their customer belongs to the same business.
  unique (id, business_id)
);

create index customers_business_id_idx on public.customers (business_id);

create trigger customers_guard before insert or update on public.customers
  for each row execute function public.guard_business_record();
create trigger customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();

-- ───────────────────────────── Reference items ─────────────────────────────

create table public.items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  name text not null check (btrim(name) <> ''),
  description text not null default '',
  category text not null default '',
  unit text not null default 'Item',
  price numeric not null default 0 check (price between 0 and 1000000000),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index items_business_id_idx on public.items (business_id);

create trigger items_guard before insert or update on public.items
  for each row execute function public.guard_business_record();
create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();

-- ───────────────────────────── Invoices and quotations ─────────────────────────────

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  customer_id uuid not null,
  kind text not null check (kind in ('invoice', 'quotation')),
  -- Assigned by documents_prepare; any value sent by a client is replaced.
  number text not null default '',
  status text not null default 'draft' check (status in ('draft', 'issued')),
  document_date date not null,
  end_date date not null,
  terms text not null default '',
  notes text not null default '',
  tax_rate numeric not null check (tax_rate between 0 and 100),
  -- Line items exactly as entered, and the issuer/customer details the
  -- document was created with. Both are frozen once the document is issued.
  lines jsonb not null default '[]' check (jsonb_typeof(lines) = 'array'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  subtotal numeric not null,
  tax numeric not null,
  total numeric not null,
  source_quotation_id uuid references public.documents (id),
  source_quotation_number text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  issued_at timestamptz,
  issued_by uuid references auth.users (id) on delete set null,
  foreign key (customer_id, business_id)
    references public.customers (id, business_id),
  constraint documents_number_unique unique (business_id, kind, number),
  constraint documents_dates check (end_date >= document_date),
  constraint documents_totals check (total = subtotal + tax),
  constraint documents_snapshot_matches check (
    snapshot -> 'issuer' ->> 'id' = business_id::text
    and snapshot -> 'customer' ->> 'id' = customer_id::text
  ),
  constraint documents_conversion_is_invoice
    check (source_quotation_id is null or kind = 'invoice')
);

-- A quotation converts into at most one invoice, even if two employees click
-- "Convert" at the same moment.
create unique index documents_one_invoice_per_quotation
  on public.documents (source_quotation_id)
  where source_quotation_id is not null;
create index documents_business_id_idx on public.documents (business_id);
create index documents_customer_id_idx on public.documents (customer_id);

create function public.prepare_document()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  biz public.businesses%rowtype;
  source public.documents%rowtype;
  next_number numeric;
begin
  select * into biz from public.businesses where id = new.business_id;
  if not found then
    raise exception 'Choose an existing client business.';
  end if;
  if biz.archived then
    raise exception 'Restore this business before creating or editing documents.';
  end if;

  if tg_op = 'INSERT' then
    if new.source_quotation_id is not null then
      select * into source from public.documents where id = new.source_quotation_id;
      if not found
        or source.kind <> 'quotation'
        or source.status <> 'issued'
        or source.business_id <> new.business_id then
        raise exception 'Only issued quotations of the same business can be converted.';
      end if;
      new.source_quotation_number := source.number;
    else
      new.source_quotation_number := null;
    end if;

    -- One number at a time per business and document type.
    perform pg_advisory_xact_lock(
      hashtextextended(new.business_id::text || ':' || new.kind, 0)
    );
    select coalesce(max(substring(d.number from '(\d+)$')::numeric), 0) + 1
      into next_number
      from public.documents d
      where d.business_id = new.business_id and d.kind = new.kind;
    new.number :=
      case when new.kind = 'invoice' then biz.invoice_prefix else biz.quotation_prefix end
      || '-'
      || case when next_number < 10000 then lpad(next_number::text, 4, '0')
              else next_number::text end;
    new.created_by := auth.uid();
    new.created_at := now();
  else
    if old.status = 'issued' then
      raise exception 'Issued documents are read-only.';
    end if;
    if new.business_id <> old.business_id or new.kind <> old.kind then
      raise exception 'The document business and type cannot change.';
    end if;
    new.number := old.number;
    new.source_quotation_id := old.source_quotation_id;
    new.source_quotation_number := old.source_quotation_number;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  if new.status = 'issued' then
    new.issued_at := now();
    new.issued_by := auth.uid();
  else
    new.issued_at := null;
    new.issued_by := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger documents_prepare before insert or update on public.documents
  for each row execute function public.prepare_document();

-- ───────────────────────────── Access rules ─────────────────────────────

alter table public.businesses enable row level security;
alter table public.customers enable row level security;
alter table public.items enable row level security;
alter table public.documents enable row level security;

create policy "Employees read businesses" on public.businesses
  for select to authenticated using ((select public.is_employee()));
create policy "Employees add businesses" on public.businesses
  for insert to authenticated with check ((select public.is_employee()));
create policy "Employees update businesses" on public.businesses
  for update to authenticated
  using ((select public.is_employee())) with check ((select public.is_employee()));

create policy "Employees read customers" on public.customers
  for select to authenticated using ((select public.is_employee()));
create policy "Employees add customers" on public.customers
  for insert to authenticated with check ((select public.is_employee()));
create policy "Employees update customers" on public.customers
  for update to authenticated
  using ((select public.is_employee())) with check ((select public.is_employee()));

create policy "Employees read items" on public.items
  for select to authenticated using ((select public.is_employee()));
create policy "Employees add items" on public.items
  for insert to authenticated with check ((select public.is_employee()));
create policy "Employees update items" on public.items
  for update to authenticated
  using ((select public.is_employee())) with check ((select public.is_employee()));

create policy "Employees read documents" on public.documents
  for select to authenticated using ((select public.is_employee()));
create policy "Employees add documents" on public.documents
  for insert to authenticated with check ((select public.is_employee()));
create policy "Employees update documents" on public.documents
  for update to authenticated
  using ((select public.is_employee())) with check ((select public.is_employee()));

-- No delete policies: records are archived, never deleted. Table privileges
-- are narrowed as well, so a missing policy is not the only safeguard.
revoke all on table
  public.employees, public.businesses, public.customers, public.items, public.documents
  from anon, authenticated;
grant select on table public.employees to authenticated;
grant select, insert, update on table
  public.businesses, public.customers, public.items, public.documents
  to authenticated;

-- ───────────────────────────── Business logos ─────────────────────────────

-- Public bucket: logos appear on every invoice, so they are readable by URL.
-- Employees may upload; nobody may overwrite or delete, so a logo printed on
-- an issued document keeps working after the business changes its logo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-logos', 'business-logos', true, 307200, array['image/png', 'image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Employees upload business logos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'business-logos' and (select public.is_employee()));
