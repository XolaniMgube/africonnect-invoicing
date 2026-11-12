-- Drafts do not reserve numbers. Issued rows are immutable; edits are linked revisions.
begin;
alter table public.documents add column revision_of_id uuid references public.documents(id);
alter table public.documents drop constraint documents_number_unique;
alter table public.documents drop constraint documents_number_length;
create unique index documents_number_unique on public.documents(business_id, kind, number) where status = 'issued';
create index documents_revision_of_idx on public.documents(revision_of_id);
-- Preserve every issued number, while releasing numbers previously assigned to drafts.
alter table public.documents disable trigger documents_prepare;
update public.documents set number = '' where status = 'draft';
alter table public.documents enable trigger documents_prepare;
alter table public.documents add constraint documents_number_length check (
  (status = 'draft' and number = '') or
  (status = 'issued' and char_length(number) between 1 and 40)
);

create or replace function public.prepare_document()
returns trigger language plpgsql set search_path = '' as $$
declare
  biz public.businesses%rowtype;
  source public.documents%rowtype;
  highest text;
  next_number text;
  prefix text;
begin
  if tg_op = 'UPDATE' then
    if old.status = 'issued' then
      raise exception 'Issued documents are preserved. Create a draft revision to make changes.';
    end if;
    if new.business_id <> old.business_id or new.kind <> old.kind then
      raise exception 'The document business and type cannot change.';
    end if;
    if new.revision_of_id is distinct from old.revision_of_id then
      raise exception 'The revision origin cannot change.';
    end if;
    new.source_quotation_id := old.source_quotation_id;
    new.source_quotation_number := old.source_quotation_number;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  select * into biz from public.businesses where id = new.business_id;
  if not found then raise exception 'Choose an existing client business.'; end if;
  if biz.archived then raise exception 'Restore this business before creating or editing documents.'; end if;

  if new.revision_of_id is not null then
    select * into source from public.documents where id = new.revision_of_id;
    if not found or source.status <> 'issued' or source.business_id <> new.business_id or source.kind <> new.kind then
      raise exception 'A revision must refer to an issued document of the same business and type.';
    end if;
  end if;
  if tg_op = 'INSERT' then
    if new.source_quotation_id is not null then
      select * into source from public.documents where id = new.source_quotation_id;
      if not found or source.kind <> 'quotation' or source.status <> 'issued' or source.business_id <> new.business_id then
        raise exception 'Only issued quotations of the same business can be converted.';
      end if;
      new.source_quotation_number := source.number;
    else
      new.source_quotation_number := null;
    end if;
    new.created_by := auth.uid();
    new.created_at := now();
  end if;

  new.number := '';
  if new.status = 'issued' then
    -- Serialise all issues for a business/type. Draft saves never take a number.
    perform pg_advisory_xact_lock(hashtextextended(new.business_id::text || ':' || new.kind, 0));
    select substring(d.number from '(\d+)$') into highest
      from public.documents d
      where d.business_id = new.business_id and d.kind = new.kind
        and d.status = 'issued' and d.number ~ '\d$'
      order by substring(d.number from '(\d+)$')::numeric desc limit 1;
    next_number := (coalesce(highest::numeric, 0) + 1)::text;
    next_number := lpad(next_number, greatest(char_length(next_number), coalesce(char_length(highest), 4)), '0');
    prefix := btrim(case when new.kind = 'invoice' then biz.invoice_prefix else biz.quotation_prefix end);
    new.number := case when prefix = '' then '' else prefix || '-' end || next_number;
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
commit;
