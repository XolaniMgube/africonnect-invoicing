-- Employees may delete customers and reference items. Items are no longer
-- archived: previously archived items become visible again (nothing is lost)
-- and can be deleted instead.
--
-- A customer used by any invoice or quotation (draft or issued) cannot be
-- deleted: the documents foreign key has no cascade, so the delete fails with
-- 23503 and the documents are untouched. Document lines copy item details, so
-- deleting an item never changes a document.
begin;

alter table public.items drop column archived;

-- Like adding or editing, deleting is not allowed while the business is archived.
create function public.guard_business_record_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.businesses
    where id = old.business_id and archived
  ) then
    raise exception 'Restore this business before editing its records.';
  end if;
  return old;
end;
$$;

create trigger customers_guard_delete before delete on public.customers
  for each row execute function public.guard_business_record_delete();
create trigger items_guard_delete before delete on public.items
  for each row execute function public.guard_business_record_delete();

create policy "Employees delete customers" on public.customers
  for delete to authenticated using ((select public.is_employee()));
create policy "Employees delete items" on public.items
  for delete to authenticated using ((select public.is_employee()));

grant delete on table public.customers, public.items to authenticated;

commit;
