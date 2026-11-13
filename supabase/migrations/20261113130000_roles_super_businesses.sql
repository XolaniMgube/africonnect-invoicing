-- Roles and super businesses.
--
--   * Employees are Admin or Staff (everyone starts as Staff). Admins manage
--     roles, which businesses are super businesses, and who can see each one.
--     There is always at least one Admin.
--   * A super business (e.g. Africonnect itself) is visible only to Admins and
--     to Staff an Admin has given access. Its customers, items and documents
--     follow the same rule. Ordinary businesses stay visible to every employee.
--   * Employees now store their email, so Admins can tell people apart.
--
-- Make the first Admin (after adding them to public.employees):
--   update public.employees set role = 'admin'
--   where user_id = (select id from auth.users where email = 'admin@example.com');
begin;

-- ───────────────────────────── Roles ─────────────────────────────

alter table public.employees
  add column role text not null default 'staff'
    constraint employees_role check (role in ('admin', 'staff')),
  add column email text not null default '';

update public.employees e
  set email = coalesce(u.email, '')
  from auth.users u
  where u.id = e.user_id;

-- Fills the email from the login when an employee is added without one.
create function public.fill_employee_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.email, '') = '' then
    select coalesce(u.email, '') into new.email
      from auth.users u where u.id = new.user_id;
    new.email := coalesce(new.email, '');
  end if;
  return new;
end;
$$;
revoke execute on function public.fill_employee_email() from public, anon, authenticated;
create trigger employees_fill_email before insert on public.employees
  for each row execute function public.fill_employee_email();

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employees
    where user_id = (select auth.uid()) and role = 'admin'
  );
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Never leave the workspace without an Admin.
create function public.guard_employee_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'admin' and new.role <> 'admin' and not exists (
    select 1 from public.employees
    where role = 'admin' and user_id <> old.user_id
  ) then
    raise exception 'Keep at least one admin.';
  end if;
  return new;
end;
$$;
create trigger employees_guard_role before update on public.employees
  for each row execute function public.guard_employee_role();

create policy "Admins read all employees" on public.employees
  for select to authenticated using ((select public.is_admin()));
create policy "Admins change roles" on public.employees
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- Only the role can be changed through the API.
grant update (role) on table public.employees to authenticated;

-- ───────────────────────────── Super businesses ─────────────────────────────

alter table public.businesses
  add column is_super boolean not null default false;

-- Only Admins decide which businesses are super businesses. (SQL Editor and
-- other server-side sessions have no signed-in user and are allowed.)
create function public.guard_super_business()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.is_super)
     or (tg_op = 'UPDATE' and new.is_super is distinct from old.is_super) then
    if (select auth.uid()) is not null and not public.is_admin() then
      raise exception 'Only an admin can change which businesses are super businesses.';
    end if;
  end if;
  return new;
end;
$$;
create trigger businesses_guard_super before insert or update on public.businesses
  for each row execute function public.guard_super_business();

-- Staff who may see a super business. Admins see every business.
create table public.business_access (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references public.employees (user_id) on delete cascade,
  granted_by uuid default auth.uid() references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index business_access_user_idx on public.business_access (user_id);
alter table public.business_access enable row level security;

create policy "Employees read their own access" on public.business_access
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "Admins grant access" on public.business_access
  for insert to authenticated with check ((select public.is_admin()));
create policy "Admins remove access" on public.business_access
  for delete to authenticated using ((select public.is_admin()));
grant select, insert, delete on table public.business_access to authenticated;

-- The visibility rule used by every business-scoped table.
create function public.can_see_business(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_employee() and (
    public.is_admin()
    or not coalesce(
      (select b.is_super from public.businesses b where b.id = target), false)
    or exists (
      select 1 from public.business_access a
      where a.business_id = target and a.user_id = (select auth.uid())
    )
  );
$$;
revoke execute on function public.can_see_business(uuid) from public, anon;
grant execute on function public.can_see_business(uuid) to authenticated;

-- Replace the "any employee" policies with the visibility rule.
drop policy "Employees read businesses" on public.businesses;
drop policy "Employees update businesses" on public.businesses;
create policy "Employees read visible businesses" on public.businesses
  for select to authenticated using ((select public.can_see_business(id)));
create policy "Employees update visible businesses" on public.businesses
  for update to authenticated
  using ((select public.can_see_business(id)))
  with check ((select public.can_see_business(id)));
-- "Employees add businesses" stays: new businesses start as ordinary ones.

drop policy "Employees read customers" on public.customers;
drop policy "Employees add customers" on public.customers;
drop policy "Employees update customers" on public.customers;
drop policy "Employees delete customers" on public.customers;
create policy "Employees read visible customers" on public.customers
  for select to authenticated using ((select public.can_see_business(business_id)));
create policy "Employees add visible customers" on public.customers
  for insert to authenticated with check ((select public.can_see_business(business_id)));
create policy "Employees update visible customers" on public.customers
  for update to authenticated
  using ((select public.can_see_business(business_id)))
  with check ((select public.can_see_business(business_id)));
create policy "Employees delete visible customers" on public.customers
  for delete to authenticated using ((select public.can_see_business(business_id)));

drop policy "Employees read items" on public.items;
drop policy "Employees add items" on public.items;
drop policy "Employees update items" on public.items;
drop policy "Employees delete items" on public.items;
create policy "Employees read visible items" on public.items
  for select to authenticated using ((select public.can_see_business(business_id)));
create policy "Employees add visible items" on public.items
  for insert to authenticated with check ((select public.can_see_business(business_id)));
create policy "Employees update visible items" on public.items
  for update to authenticated
  using ((select public.can_see_business(business_id)))
  with check ((select public.can_see_business(business_id)));
create policy "Employees delete visible items" on public.items
  for delete to authenticated using ((select public.can_see_business(business_id)));

drop policy "Employees read documents" on public.documents;
drop policy "Employees add documents" on public.documents;
drop policy "Employees update documents" on public.documents;
create policy "Employees read visible documents" on public.documents
  for select to authenticated using ((select public.can_see_business(business_id)));
create policy "Employees add visible documents" on public.documents
  for insert to authenticated with check ((select public.can_see_business(business_id)));
create policy "Employees update visible documents" on public.documents
  for update to authenticated
  using ((select public.can_see_business(business_id)))
  with check ((select public.can_see_business(business_id)));

commit;
