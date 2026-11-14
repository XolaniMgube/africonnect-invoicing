-- Database rules for Africonnect Invoicing. Run with `npm run db:test`
-- (local Supabase must be running). Everything happens in one transaction
-- that is rolled back, so no test data is left behind.
begin;
create extension if not exists pgtap with schema extensions;
select plan(126);

-- People: one employee, one signed-in user who is not an employee.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'staff@africonnectsolutions.co.za'),
  ('00000000-0000-4000-8000-000000000002', 'stranger@example.com');
insert into public.employees (user_id, full_name)
  values ('00000000-0000-4000-8000-000000000001', 'Test Staff');

-- ─── Anonymous visitors see nothing ───
set local role anon;
select throws_ok(
  'select * from public.businesses',
  '42501', null, 'anonymous visitors cannot read businesses');
select throws_ok(
  'select * from public.documents',
  '42501', null, 'anonymous visitors cannot read documents');
reset role;

-- ─── Signed in, but not an employee ───
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select ok(not public.is_employee(), 'a user who is not listed is not an employee');
select throws_ok(
  $$insert into public.businesses (id, name, email, address, invoice_prefix, quotation_prefix)
    values ('10000000-0000-4000-8000-000000000009', 'Sneaky', 'x@y.z', 'Somewhere', 'S-INV', 'S-QUO')$$,
  '42501', null, 'non-employees cannot add businesses');
reset role;

-- ─── Employee ───
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select ok(public.is_employee(), 'a listed user is an employee');
select is(
  (select full_name from public.employees),
  'Test Staff', 'employees can read their own record');

select lives_ok(
  $$insert into public.businesses (id, name, email, address, invoice_prefix, quotation_prefix, tax_rate, vat)
    values ('10000000-0000-4000-8000-000000000001', 'Test Builders', 'hello@test.example', '1 Test Street', 'TB-INV', 'TB-QUO', 15, 'VAT-1'),
           ('10000000-0000-4000-8000-000000000002', 'Other Co', 'hi@other.example', '2 Other Street', 'OC-INV', 'OC-QUO', 0, '')$$,
  'employees can add businesses');
select lives_ok(
  $$insert into public.businesses (name, email, address, invoice_prefix, quotation_prefix, tax_rate)
    values ('No VAT number', 'a@b.c', 'Here', 'NV-INV', 'NV-QUO', 15)$$,
  'a new business can charge VAT without a registration number');
select lives_ok(
  $$update public.businesses set vat = '', tax_rate = 15
    where id = '10000000-0000-4000-8000-000000000001'$$,
  'business settings allow clearing the VAT number while keeping a positive rate');
select throws_ok(
  $$insert into public.businesses (name, email, address, invoice_prefix, quotation_prefix)
    values ('Same prefixes', 'a@b.c', 'Here', 'DOC', 'doc')$$,
  '23514', null, 'invoice and quotation prefixes must differ');
select is(
  (select template || ' ' || secondary_accent from public.businesses
   where id = '10000000-0000-4000-8000-000000000001'),
  'classic #C9A45C', 'businesses start with the Classic template');
select lives_ok(
  $$update public.businesses
    set template = 'executive', signatory_name = 'T. Example', closing_message = 'Thanks!'
    where id = '10000000-0000-4000-8000-000000000002'$$,
  'a business can switch to the Executive template');
select throws_ok(
  $$update public.businesses set template = 'fancy'
    where id = '10000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'only known templates are accepted');

insert into public.customers (id, business_id, name) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Customer A'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Customer of Other Co');
select throws_ok(
  $$update public.customers set business_id = '10000000-0000-4000-8000-000000000002'
    where id = '20000000-0000-4000-8000-000000000001'$$,
  'P0001', 'Cannot move a record between businesses.',
  'customers cannot move between businesses');

-- A minimal document for business 1 / customer A.
create function pg_temp.new_doc(doc_id uuid, doc_kind text, extra jsonb default '{}')
returns void language sql as $$
  insert into public.documents
  select * from jsonb_populate_record(null::public.documents, jsonb_build_object(
    'id', doc_id,
    'business_id', '10000000-0000-4000-8000-000000000001',
    'customer_id', '20000000-0000-4000-8000-000000000001',
    'kind', doc_kind,
    'number', '',
    'status', 'draft',
    'document_date', '2026-11-05',
    'end_date', '2026-12-05',
    'terms', '', 'notes', '',
    'tax_rate', 15, 'discount_amount', 0, 'show_item_prices', true,
    'lines', '[{"id":"l1","name":"Work","description":"","unit":"Item","quantity":1,"price":100}]'::jsonb,
    'snapshot', '{"issuer":{"id":"10000000-0000-4000-8000-000000000001"},"customer":{"id":"20000000-0000-4000-8000-000000000001"}}'::jsonb,
    'subtotal', 100, 'tax', 15, 'total', 115,
    'created_at', now(), 'updated_at', now()
  ) || extra);
$$;

select pg_temp.new_doc('30000000-0000-4000-8000-000000000001', 'invoice');
select pg_temp.new_doc('30000000-0000-4000-8000-000000000002', 'invoice');
select pg_temp.new_doc('30000000-0000-4000-8000-000000000003', 'quotation');
select is(
  array(select number from public.documents
        where business_id = '10000000-0000-4000-8000-000000000001' order by number),
  array['', '', ''],
  'drafts do not reserve official numbers');
select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'documents' and column_name = 'show_item_prices'),
  'true', 'documents show item prices unless told otherwise');
select is(
  (select created_by from public.documents where id = '30000000-0000-4000-8000-000000000001'),
  '00000000-0000-4000-8000-000000000001'::uuid,
  'documents record who created them');

select throws_ok(
  $$select pg_temp.new_doc('30000000-0000-4000-8000-000000000009', 'invoice',
      '{"customer_id":"20000000-0000-4000-8000-000000000002","snapshot":{"issuer":{"id":"10000000-0000-4000-8000-000000000001"},"customer":{"id":"20000000-0000-4000-8000-000000000002"}}}')$$,
  '23503', null, 'a document''s customer must belong to the same business');
select throws_ok(
  $$select pg_temp.new_doc('30000000-0000-4000-8000-000000000009', 'invoice',
      '{"snapshot":{"issuer":{"id":"10000000-0000-4000-8000-000000000002"},"customer":{"id":"20000000-0000-4000-8000-000000000001"}}}')$$,
  '23514', null, 'the snapshot must describe the document''s own business and customer');
select throws_ok(
  $$select pg_temp.new_doc('30000000-0000-4000-8000-000000000009', 'invoice', '{"total": 999}')$$,
  '23514', null, 'totals must add up');

-- Drafts can change; an empty number keeps the current one.
update public.documents set notes = 'Updated', number = ''
  where id = '30000000-0000-4000-8000-000000000001';
select is(
  (select notes || ' ' || number from public.documents where id = '30000000-0000-4000-8000-000000000001'),
  'Updated ', 'drafts can be edited without receiving a number');

-- Issuing records when and by whom; issued invoices can still be edited.
update public.documents set status = 'issued'
  where id = '30000000-0000-4000-8000-000000000001';
select ok(
  (select issued_at is not null and issued_by is not null
   from public.documents where id = '30000000-0000-4000-8000-000000000001'),
  'issuing records when and by whom');
select throws_ok(
  $$update public.documents set notes = 'Changed after issue'
    where id = '30000000-0000-4000-8000-000000000001'$$,
  'P0001', 'Issued documents are preserved. Create a draft revision to make changes.',
  'issued invoices cannot be overwritten');
select throws_ok(
  $$update public.documents set status = 'draft'
    where id = '30000000-0000-4000-8000-000000000001'$$,
  'P0001', 'Issued documents are preserved. Create a draft revision to make changes.',
  'issued invoices cannot return to draft');
select throws_ok(
  $$delete from public.documents where id = '30000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'documents cannot be deleted');
select throws_ok(
  $$delete from public.businesses where id = '10000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'businesses cannot be deleted');

-- Customers and items can be deleted, unless a document uses the customer.
insert into public.customers (id, business_id, name) values
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Unused customer');
insert into public.items (id, business_id, name) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Old item'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Frozen item');
select throws_ok(
  $$delete from public.customers where id = '20000000-0000-4000-8000-000000000001'$$,
  '23503', null, 'a customer used by documents cannot be deleted');
-- A signed-in non-employee deletes nothing.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
delete from public.customers where id = '20000000-0000-4000-8000-000000000003';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select ok(
  exists(select 1 from public.customers where id = '20000000-0000-4000-8000-000000000003'),
  'non-employees cannot delete customers');
select lives_ok(
  $$delete from public.customers where id = '20000000-0000-4000-8000-000000000003'$$,
  'employees can delete an unused customer');
select lives_ok(
  $$delete from public.items where id = '40000000-0000-4000-8000-000000000001'$$,
  'employees can delete items');
select is(
  (select count(*)::int from public.customers c, public.items i
   where c.id = '20000000-0000-4000-8000-000000000003'
      or i.id = '40000000-0000-4000-8000-000000000001'),
  0, 'deleted customers and items are gone');

-- Conversion: only from an issued quotation, and only once.
select throws_ok(
  $$select pg_temp.new_doc('30000000-0000-4000-8000-000000000004', 'invoice',
      '{"source_quotation_id":"30000000-0000-4000-8000-000000000003"}')$$,
  'P0001', 'Only issued quotations of the same business can be converted.',
  'draft quotations cannot be converted');
update public.documents set status = 'issued'
  where id = '30000000-0000-4000-8000-000000000003';
select throws_ok(
  $$update public.documents set notes = 'Changed after issue'
    where id = '30000000-0000-4000-8000-000000000003'$$,
  'P0001', 'Issued documents are preserved. Create a draft revision to make changes.',
  'issued quotations cannot be overwritten');
select lives_ok(
  $$select pg_temp.new_doc('30000000-0000-4000-8000-000000000004', 'invoice',
      '{"source_quotation_id":"30000000-0000-4000-8000-000000000003","source_quotation_number":"FAKE"}')$$,
  'an issued quotation converts into an invoice');
select is(
  (select source_quotation_number from public.documents where id = '30000000-0000-4000-8000-000000000004'),
  'TB-QUO-0001', 'the linked quotation number comes from the database');
select throws_ok(
  $$select pg_temp.new_doc('30000000-0000-4000-8000-000000000005', 'invoice',
      '{"source_quotation_id":"30000000-0000-4000-8000-000000000003"}')$$,
  '23505', null, 'a quotation converts into at most one invoice');
select throws_ok(
  $$select pg_temp.new_doc('30000000-0000-4000-8000-000000000005', 'quotation',
      '{"source_quotation_id":"30000000-0000-4000-8000-000000000003"}')$$,
  '23514', null, 'only invoices can come from a quotation');

-- Archived businesses are frozen.
update public.businesses set archived = true
  where id = '10000000-0000-4000-8000-000000000001';
select throws_ok(
  $$insert into public.customers (business_id, name)
    values ('10000000-0000-4000-8000-000000000001', 'Late customer')$$,
  'P0001', 'Restore this business before editing its records.',
  'archived businesses accept no new customers');
select throws_ok(
  $$insert into public.items (business_id, name)
    values ('10000000-0000-4000-8000-000000000001', 'Late item')$$,
  'P0001', 'Restore this business before editing its records.',
  'archived businesses accept no new items');
select throws_ok(
  $$update public.documents set notes = 'x' where id = '30000000-0000-4000-8000-000000000002'$$,
  'P0001', 'Restore this business before creating or editing documents.',
  'drafts of archived businesses cannot change');
select throws_ok(
  $$delete from public.items where id = '40000000-0000-4000-8000-000000000002'$$,
  'P0001', 'Restore this business before editing its records.',
  'items of archived businesses cannot be deleted');
update public.businesses set archived = false
  where id = '10000000-0000-4000-8000-000000000001';
select lives_ok(
  $$insert into public.customers (business_id, name)
    values ('10000000-0000-4000-8000-000000000001', 'Welcome back')$$,
  'restored businesses accept records again');

-- Revisions are separate drafts and only receive a number when issued.
select lives_ok(
  $$select pg_temp.new_doc('30000000-0000-4000-8000-000000000020', 'invoice',
    '{"revision_of_id":"30000000-0000-4000-8000-000000000001","number":"9999"}')$$,
  'an issued invoice can have a draft revision');
select is(
  (select number from public.documents where id = '30000000-0000-4000-8000-000000000020'),
  '', 'a revision draft has no official number even if a client supplies one');
update public.documents set status = 'issued' where id = '30000000-0000-4000-8000-000000000020';
select is(
  (select number from public.documents where id = '30000000-0000-4000-8000-000000000020'),
  'TB-INV-0002', 'issuing the revision assigns the next official number');
select is(
  (select notes || ' ' || number from public.documents where id = '30000000-0000-4000-8000-000000000001'),
  'Updated TB-INV-0001', 'the original remains unchanged');
select throws_ok(
  $$select pg_temp.new_doc('30000000-0000-4000-8000-000000000021', 'quotation',
    '{"revision_of_id":"30000000-0000-4000-8000-000000000001"}')$$,
  'P0001', 'A revision must refer to an issued document of the same business and type.',
  'a revision cannot change document type');
select throws_ok(
  $$select pg_temp.new_doc('30000000-0000-4000-8000-000000000021', 'invoice',
    '{"revision_of_id":"30000000-0000-4000-8000-000000000002"}')$$,
  'P0001', 'A revision must refer to an issued document of the same business and type.',
  'a draft cannot be a revision origin');
select lives_ok(
  $$update public.businesses set invoice_prefix = '', quotation_prefix = ''
    where id = '10000000-0000-4000-8000-000000000001'$$,
  'invoice and quotation prefixes may be empty');
select pg_temp.new_doc('30000000-0000-4000-8000-000000000023', 'invoice', '{"status":"issued"}');
select is(
  (select number from public.documents where id = '30000000-0000-4000-8000-000000000023'),
  '0003', 'without a prefix, an issued number is just the digits');

-- Fixed discounts and the accounting identity are enforced for direct writes too.
select lives_ok(
  $$select pg_temp.new_doc('30000000-0000-4000-8000-000000000030', 'invoice',
    '{"discount_amount":10,"tax":13.5,"total":103.5}')$$,
  'a discounted invoice has balanced totals');
select throws_ok(
  $$select pg_temp.new_doc('30000000-0000-4000-8000-000000000031', 'quotation',
    '{"discount_amount":101,"tax":0,"total":-1}')$$,
  '23514', null, 'discount cannot exceed subtotal');
select throws_ok(
  $$select pg_temp.new_doc('30000000-0000-4000-8000-000000000032', 'invoice',
    '{"discount_amount":-1,"tax":15,"total":116}')$$,
  '23514', null, 'discount cannot be negative');
select throws_ok(
  $$select pg_temp.new_doc('30000000-0000-4000-8000-000000000033', 'invoice',
    '{"discount_amount":10,"tax":13.5,"total":115}')$$,
  '23514', null, 'total must subtract the discount');

reset role;

-- ─── Roles and super businesses ───
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000003', 'boss@africonnectsolutions.co.za');
insert into public.employees (user_id, full_name)
  values ('00000000-0000-4000-8000-000000000003', 'Boss');
select is(
  (select email from public.employees where user_id = '00000000-0000-4000-8000-000000000003'),
  'boss@africonnectsolutions.co.za', 'employees get their login email');
update public.employees set role = 'admin'
  where user_id = '00000000-0000-4000-8000-000000000003';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select ok(not public.is_admin(), 'employees start as staff');
select throws_ok(
  $$update public.businesses set is_super = true
    where id = '10000000-0000-4000-8000-000000000002'$$,
  'P0001', 'Only an admin can change which businesses are super businesses.',
  'staff cannot make a super business');
update public.employees set role = 'admin'
  where user_id = '00000000-0000-4000-8000-000000000001';
select ok(not public.is_admin(), 'staff cannot promote themselves');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select ok(public.is_admin(), 'admins are recognised');
select lives_ok(
  $$update public.businesses set is_super = true
    where id = '10000000-0000-4000-8000-000000000002'$$,
  'admins can make a super business');
select is((select count(*)::int from public.employees), 2,
  'admins see every employee');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from public.businesses
   where id = '10000000-0000-4000-8000-000000000002'),
  0, 'staff without access cannot see a super business');
select is(
  (select count(*)::int from public.customers
   where business_id = '10000000-0000-4000-8000-000000000002'),
  0, 'nor its customers');
select throws_ok(
  $$insert into public.customers (business_id, name)
    values ('10000000-0000-4000-8000-000000000002', 'Sneaky')$$,
  '42501', null, 'nor add records to it');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select lives_ok(
  $$insert into public.business_access (business_id, user_id)
    values ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001')$$,
  'admins give staff access to a super business');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from public.businesses
   where id = '10000000-0000-4000-8000-000000000002'),
  1, 'staff with access see the super business');
select is(
  (select count(*)::int from public.customers
   where business_id = '10000000-0000-4000-8000-000000000002'),
  1, 'and its customers');
select throws_ok(
  $$insert into public.business_access (business_id, user_id)
    values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'staff cannot give access');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select throws_ok(
  $$update public.employees set role = 'staff'
    where user_id = '00000000-0000-4000-8000-000000000003'$$,
  'P0001', 'Keep at least one admin.', 'the last admin cannot be demoted');

-- ─── Payments, due dates and cancelling (super businesses) ───
update public.businesses set is_super = true where id = '10000000-0000-4000-8000-000000000001';
select pg_temp.new_doc('30000000-0000-4000-8000-000000000040', 'invoice', '{"status":"issued"}');
select lives_ok($$insert into public.payments (document_id, business_id, amount, paid_on, method)
    values ('30000000-0000-4000-8000-000000000040', '10000000-0000-4000-8000-000000000001', 50, '2026-11-10', 'eft')$$, 'part-payments are recorded');
select is(
  (select business_id::text from public.payments where document_id = '30000000-0000-4000-8000-000000000040'),
  '10000000-0000-4000-8000-000000000001', 'a payment belongs to its invoice''s business');
select throws_ok($$insert into public.payments (document_id, business_id, amount, paid_on, method)
    values ('30000000-0000-4000-8000-000000000040', '10000000-0000-4000-8000-000000000001', 70, '2026-11-10', 'eft')$$,
  'P0001', 'The payment is more than the balance due.', 'payments cannot exceed the total');
select throws_ok($$insert into public.payments (document_id, business_id, amount, paid_on, method)
    values ('30000000-0000-4000-8000-000000000040', '10000000-0000-4000-8000-000000000001', 0.005, '2026-11-10', 'eft')$$,
  '23514', null, 'payments are whole cents');
select lives_ok($$insert into public.payments (document_id, business_id, amount, paid_on, method)
    values ('30000000-0000-4000-8000-000000000040', '10000000-0000-4000-8000-000000000001', 65, '2026-11-10', 'eft')$$, 'the balance can be paid in full');
select throws_ok($$insert into public.payments (document_id, business_id, amount, paid_on, method)
    values ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 10, '2026-11-10', 'eft')$$,
  'P0001', 'This invoice was replaced by a revision.', 'superseded invoices take no payments');
select throws_ok($$insert into public.payments (document_id, business_id, amount, paid_on, method)
    values ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 10, '2026-11-10', 'eft')$$,
  'P0001', 'Payments can be recorded only on issued invoices of super businesses.',
  'quotations take no payments');
select throws_ok(
  $$insert into public.invoice_tracking (document_id, business_id, cancelled_at)
    values ('30000000-0000-4000-8000-000000000040', '10000000-0000-4000-8000-000000000001', now())$$,
  'P0001', 'This invoice has payments recorded. Delete them before cancelling it.',
  'an invoice with payments cannot be cancelled');
select throws_ok(
  $$select pg_temp.new_doc('30000000-0000-4000-8000-000000000041', 'invoice',
    '{"revision_of_id":"30000000-0000-4000-8000-000000000040"}')$$,
  'P0001', 'This invoice has payments recorded. Delete them before editing it.',
  'an invoice with payments cannot be revised');
select lives_ok(
  $$insert into public.invoice_tracking (document_id, business_id, cancelled_at, cancel_reason)
    values ('30000000-0000-4000-8000-000000000023', '10000000-0000-4000-8000-000000000001', now(), 'Duplicate')$$,
  'an unpaid invoice can be cancelled');
select throws_ok($$insert into public.payments (document_id, business_id, amount, paid_on, method)
    values ('30000000-0000-4000-8000-000000000023', '10000000-0000-4000-8000-000000000001', 10, '2026-11-10', 'eft')$$,
  'P0001', 'Restore this invoice before recording a payment.', 'cancelled invoices take no payments');
select throws_ok(
  $$update public.invoice_tracking set due_date = '2020-01-01'
    where document_id = '30000000-0000-4000-8000-000000000023'$$,
  'P0001', 'The due date can’t be before the invoice date.', 'due dates follow the invoice date');
update public.invoice_tracking set cancelled_at = null
  where document_id = '30000000-0000-4000-8000-000000000023';
select is(
  (select cancel_reason from public.invoice_tracking
   where document_id = '30000000-0000-4000-8000-000000000023'),
  '', 'a restored invoice forgets its cancel reason');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from public.payments where document_id = '30000000-0000-4000-8000-000000000040'),
  0, 'staff without access cannot see a super business''s payments');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select lives_ok(
  $$delete from public.payments where document_id = '30000000-0000-4000-8000-000000000040' and amount = 65$$,
  'payments can be deleted to correct mistakes');

-- ─── Emailing invoices ───
select throws_ok(
  $$update public.businesses set email_from = 'not an email' where id = '10000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'the sender address must be an email address');
select lives_ok(
  $$update public.businesses set email_from = 'info@africonnectsolutions.co.za' where id = '10000000-0000-4000-8000-000000000001'$$,
  'a business can set its sender address');
select throws_ok(
  $$insert into public.email_log (document_id, business_id, recipients, subject, status)
    values ('30000000-0000-4000-8000-000000000040', '10000000-0000-4000-8000-000000000001', '{a@b.co}', 'Hi', 'sent')$$,
  '42501', null, 'only the email service writes the email log');
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('invoice-pdfs', '10000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000040.pdf')$$,
  'an issued invoice''s PDF can be saved');
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('invoice-pdfs', '10000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000002.pdf')$$,
  '42501', null, 'drafts have no saved PDF');
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('invoice-pdfs', 'anything/else.pdf')$$,
  '42501', null, 'saved PDFs follow the business/invoice path');

-- ─── Own mailbox (SMTP) settings ───
select lives_ok(
  $$select public.set_mail_settings('10000000-0000-4000-8000-000000000001', 'Mail.Example.co.za', 465, 'info@example.co.za', 'secret')$$,
  'admins save a super business''s mail settings');
select throws_ok(
  $$select password_secret from public.mail_settings$$,
  '42501', null, 'nobody reads the password reference through the API');
select throws_ok(
  $$select * from public.mail_settings_for_send('10000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'only the email function can read the password');
select ok(
  not has_table_privilege('anon', 'public.payments', 'select')
    and not has_table_privilege('authenticated', 'public.payments', 'update')
    and not has_table_privilege('authenticated', 'public.email_log', 'insert')
    and not has_table_privilege('authenticated', 'public.mail_settings', 'insert'),
  'table privileges are limited to what the app uses');
select lives_ok(
  $$select public.set_mail_settings('10000000-0000-4000-8000-000000000001', 'mail.example.co.za', 587, 'info@example.co.za', '')$$,
  'an empty password keeps the saved one');
select throws_ok(
  $$select public.set_mail_settings('10000000-0000-4000-8000-0000000000ff', 'mail.example.co.za', 465, 'x@y.co', 'p')$$,
  'P0001', 'Mail settings are for super businesses.', 'mail settings need a super business');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.set_mail_settings('10000000-0000-4000-8000-000000000001', 'evil.example.com', 465, 'x@y.co', 'p')$$,
  'P0001', 'Only an admin can change mail settings.', 'staff cannot change mail settings');
select is((select count(*)::int from public.mail_settings), 0, 'staff cannot see mail settings');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
reset role;
select is(
  (select host || ':' || port || ' ' || password from public.mail_settings_for_send('10000000-0000-4000-8000-000000000001')),
  'mail.example.co.za:587 secret', 'the password is stored encrypted and read back for sending');
set local role authenticated;

-- ─── Scheduled reminders ───
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select lives_ok($$insert into public.reminders (id, document_id, business_id, send_on, recipients, subject)
    values ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000040', '10000000-0000-4000-8000-000000000001', public.sa_today() + 3, '{client@x.co.za}', 'Reminder')$$, 'admins schedule a reminder');
select throws_ok($$insert into public.reminders (id, document_id, business_id, send_on, recipients, subject)
    values ('50000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000040', '10000000-0000-4000-8000-000000000001', public.sa_today() + -1, '{client@x.co.za}', 'Reminder')$$,
  'P0001', 'Choose today or a later date.', 'reminders cannot be scheduled in the past');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select throws_ok($$insert into public.reminders (id, document_id, business_id, send_on, recipients, subject)
    values ('50000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000040', '10000000-0000-4000-8000-000000000001', public.sa_today() + 1, '{client@x.co.za}', 'Reminder')$$,
  'P0001', 'Only an admin can schedule or cancel reminders.', 'staff cannot schedule reminders');
update public.reminders set status = 'cancelled' where id = '50000000-0000-4000-8000-000000000001';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select is((select status from public.reminders where id = '50000000-0000-4000-8000-000000000001'), 'scheduled',
  'staff cannot cancel reminders');
select lives_ok($$update public.reminders set status = 'cancelled' where id = '50000000-0000-4000-8000-000000000001'$$,
  'admins cancel a scheduled reminder');
select is((select error from public.reminders where id = '50000000-0000-4000-8000-000000000001'), 'Cancelled by an admin.',
  'a cancelled reminder says who cancelled it');
select throws_ok($$update public.reminders set status = 'scheduled' where id = '50000000-0000-4000-8000-000000000001'$$,
  'P0001', 'Only a scheduled reminder can be cancelled.', 'a cancelled reminder stays cancelled');
select lives_ok($$insert into public.reminders (id, document_id, business_id, send_on, recipients, subject)
    values ('50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000040', '10000000-0000-4000-8000-000000000001', public.sa_today() + 5, '{client@x.co.za}', 'Reminder')$$, 'another reminder can be scheduled');
insert into public.business_access (business_id, user_id)
  values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select lives_ok(
  $$insert into public.payments (document_id, business_id, amount, paid_on, method)
    values ('30000000-0000-4000-8000-000000000040', '10000000-0000-4000-8000-000000000001', 65, '2026-11-12', 'eft')$$,
  'staff can still record the payment that settles an invoice with reminders');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select is(
  (select status || ': ' || error from public.reminders where id = '50000000-0000-4000-8000-000000000002'),
  'cancelled: Not sent: the invoice was paid.', 'paying in full cancels scheduled reminders');
select throws_ok($$insert into public.reminders (id, document_id, business_id, send_on, recipients, subject)
    values ('50000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000040', '10000000-0000-4000-8000-000000000001', public.sa_today() + 1, '{client@x.co.za}', 'Reminder')$$,
  'P0001', 'This invoice is already paid.', 'paid invoices take no reminders');
select lives_ok($$insert into public.reminders (id, document_id, business_id, send_on, recipients, subject)
    values ('50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000023', '10000000-0000-4000-8000-000000000001', public.sa_today() + 2, '{client@x.co.za}', 'Reminder')$$, 'an unpaid invoice takes a reminder');
update public.invoice_tracking set cancelled_at = now() where document_id = '30000000-0000-4000-8000-000000000023';
select is(
  (select status || ': ' || error from public.reminders where id = '50000000-0000-4000-8000-000000000003'),
  'cancelled: Not sent: the invoice was cancelled.', 'cancelling the invoice cancels its reminders');
update public.invoice_tracking set cancelled_at = null where document_id = '30000000-0000-4000-8000-000000000023';
select throws_ok($$select public.reminder_token_ok('x')$$,
  '42501', null, 'only the reminders function can check the daily job''s key');
reset role;
select ok(
  public.reminder_token_ok((select decrypted_secret from vault.decrypted_secrets where name = 'reminders_token'))
    and not public.reminder_token_ok('wrong'),
  'the daily job''s key is random and checked exactly');
select throws_ok($$select public.schedule_daily_reminders('http://evil.example.com')$$,
  'P0001', 'Use the project URL, e.g. https://abcd.supabase.co', 'the daily job only calls a Supabase project');
select public.schedule_daily_reminders('https://abcd.supabase.co');
select ok(
  (select schedule from cron.job where jobname = 'send-due-reminders') = '0 10 * * *'
    and (select command from cron.job where jobname = 'send-due-reminders')
        like '%https://abcd.supabase.co/functions/v1/send-reminders%',
  'the daily job runs at 12:00 South African time (10:00 UTC)');
set local role authenticated;

-- ─── Automatic reminder rules ───
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select is(
  (select auto_reminders::text || ' ' || reminder_offsets::text from public.businesses where id = '10000000-0000-4000-8000-000000000001'),
  'false {0,7,14}', 'automatic reminders start off, with due date, +7 and +14 days');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select throws_ok(
  $$update public.businesses set auto_reminders = true where id = '10000000-0000-4000-8000-000000000001'$$,
  'P0001', 'Only an admin can change automatic reminders.', 'staff cannot switch on automatic reminders');
select lives_ok(
  $$update public.businesses set phone = '+27 00 000 0001' where id = '10000000-0000-4000-8000-000000000001'$$,
  'staff can still edit the rest of the profile');
select throws_ok(
  $$insert into public.invoice_tracking (document_id, business_id, auto_reminders_paused)
    values ('30000000-0000-4000-8000-000000000023', '10000000-0000-4000-8000-000000000001', true)
    on conflict (document_id) do update set auto_reminders_paused = true$$,
  'P0001', 'Only an admin can pause automatic reminders.', 'staff cannot pause automatic reminders');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select lives_ok(
  $$update public.businesses set auto_reminders = true, reminder_offsets = '{-3,0,30}' where id = '10000000-0000-4000-8000-000000000001'$$,
  'admins set the rules');
select throws_ok(
  $$update public.businesses set reminder_offsets = '{400}' where id = '10000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'rules stay within 30 days before and a year after the due date');
select lives_ok(
  $$update public.invoice_tracking set auto_reminders_paused = true where document_id = '30000000-0000-4000-8000-000000000023'$$,
  'admins pause automatic reminders for one invoice');
update public.invoice_tracking set auto_reminders_paused = false where document_id = '30000000-0000-4000-8000-000000000023';
insert into public.reminders (id, document_id, business_id, send_on, recipients, subject, rule_offset)
  values ('50000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000023', '10000000-0000-4000-8000-000000000001', public.sa_today() + 1, '{a@b.co}', 'R', 7);
select is(
  (select rule_offset from public.reminders where id = '50000000-0000-4000-8000-000000000009'),
  null, 'reminders made in the app are never automatic ones');
reset role;

-- ─── Logo storage ───
select is(
  (select public from storage.buckets where id = 'business-logos'),
  true, 'the logo bucket is public so logos print on documents');
select is(
  (select file_size_limit from storage.buckets where id = 'business-logos'),
  3145728::bigint, 'logos are limited to 3 MB');

select * from finish();
rollback;
