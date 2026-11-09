-- Issued invoices can be edited in place: the number, type, business, origin
-- and original issue date/employee are kept, and the invoice stays issued.
-- Issued quotations remain read-only. Everything else (numbering, archived
-- businesses, conversions) is unchanged from the first migration.
create or replace function public.prepare_document()
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
    if old.status = 'issued' and old.kind <> 'invoice' then
      raise exception 'Issued quotations are read-only.';
    end if;
    if old.status = 'issued' and new.status <> 'issued' then
      raise exception 'An issued invoice cannot go back to being a draft.';
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
