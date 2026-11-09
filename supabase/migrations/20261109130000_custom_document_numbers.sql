-- Document numbering that fits businesses' existing numbering:
-- * Invoice and quotation prefixes may be empty (plain numbers such as 0001).
-- * Employees may type a document's number (for example to continue from
--   0123); an empty number means "the next one", and on an update "unchanged".
-- * The next number is one more than the highest trailing number the business
--   has used for that type, keeping its zero-padding (0123 → 0124; 4 digits
--   when there is none yet), after the prefix and a hyphen (no prefix: just the
--   digits). `nextNumber` in src/domain/documents.ts follows the same rule.
-- Numbers stay unique per business and type (documents_number_unique).

alter table public.businesses
  drop constraint businesses_invoice_prefix_check,
  drop constraint businesses_quotation_prefix_check,
  drop constraint businesses_distinct_prefixes;
alter table public.businesses
  add constraint businesses_invoice_prefix_check
    check (invoice_prefix ~ '^([A-Za-z0-9][A-Za-z0-9-]{0,11})?$'),
  add constraint businesses_quotation_prefix_check
    check (quotation_prefix ~ '^([A-Za-z0-9][A-Za-z0-9-]{0,11})?$'),
  add constraint businesses_distinct_prefixes
    check (invoice_prefix = '' or upper(invoice_prefix) <> upper(quotation_prefix));

alter table public.documents
  add constraint documents_number_length
    check (char_length(number) between 1 and 40);

create or replace function public.prepare_document()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  biz public.businesses%rowtype;
  source public.documents%rowtype;
  highest text;
  next_number text;
  prefix text;
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

    new.number := btrim(coalesce(new.number, ''));
    if new.number = '' then
      -- One number at a time per business and document type.
      perform pg_advisory_xact_lock(
        hashtextextended(new.business_id::text || ':' || new.kind, 0)
      );
      select substring(d.number from '(\d+)$')
        into highest
        from public.documents d
        where d.business_id = new.business_id
          and d.kind = new.kind
          and d.number ~ '\d$'
        order by substring(d.number from '(\d+)$')::numeric desc
        limit 1;
      next_number := (coalesce(highest::numeric, 0) + 1)::text;
      next_number := lpad(
        next_number,
        greatest(char_length(next_number), coalesce(char_length(highest), 4)),
        '0'
      );
      prefix := btrim(
        case when new.kind = 'invoice' then biz.invoice_prefix
             else biz.quotation_prefix end
      );
      new.number :=
        case when prefix = '' then '' else prefix || '-' end || next_number;
    end if;
    new.created_by := auth.uid();
    new.created_at := now();
  else
    if old.status = 'issued' and old.kind <> 'invoice' then
      raise exception 'Issued quotations are read-only.';
    end if;
    if old.status = 'issued' and new.status <> 'issued' then
      raise exception 'An issued invoice cannot go back to being a draft.';
    end if;
    if new.business_id <> old.business_id or new.kind <> old.kind then
      raise exception 'The document business and type cannot change.';
    end if;
    -- A typed number replaces the old one; an empty one keeps it.
    new.number := coalesce(nullif(btrim(new.number), ''), old.number);
    new.source_quotation_id := old.source_quotation_id;
    new.source_quotation_number := old.source_quotation_number;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  if tg_op = 'UPDATE' and old.status = 'issued' then
    -- An edit keeps when, and by whom, the invoice was first issued.
    new.issued_at := old.issued_at;
    new.issued_by := old.issued_by;
  elsif new.status = 'issued' then
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
