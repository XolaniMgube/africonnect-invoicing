-- Database rules for Africonnect Invoicing. Run with `npm run db:test`
-- (local Supabase must be running). Everything happens in one transaction
-- that is rolled back, so no test data is left behind.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

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
select throws_ok(
  $$insert into public.businesses (name, email, address, invoice_prefix, quotation_prefix, tax_rate)
    values ('No VAT number', 'a@b.c', 'Here', 'NV-INV', 'NV-QUO', 15)$$,
  '23514', null, 'charging VAT requires a VAT number');
select throws_ok(
  $$insert into public.businesses (name, email, address, invoice_prefix, quotation_prefix)
    values ('Same prefixes', 'a@b.c', 'Here', 'DOC', 'doc')$$,
  '23514', null, 'invoice and quotation prefixes must differ');

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
    'number', 'CLIENT-CHOSEN-999',
    'status', 'draft',
    'document_date', '2026-11-05',
    'end_date', '2026-12-05',
    'terms', '', 'notes', '',
    'tax_rate', 15,
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
  array['TB-INV-0001', 'TB-INV-0002', 'TB-QUO-0001'],
  'the database numbers documents per business and type, ignoring client numbers');
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

-- Drafts can change; the number cannot.
update public.documents set notes = 'Updated', number = 'HACKED'
  where id = '30000000-0000-4000-8000-000000000001';
select is(
  (select notes || ' ' || number from public.documents where id = '30000000-0000-4000-8000-000000000001'),
  'Updated TB-INV-0001', 'drafts can be edited but keep their number');

-- Issuing locks the document.
update public.documents set status = 'issued'
  where id = '30000000-0000-4000-8000-000000000001';
select ok(
  (select issued_at is not null and issued_by is not null
   from public.documents where id = '30000000-0000-4000-8000-000000000001'),
  'issuing records when and by whom');
select throws_ok(
  $$update public.documents set notes = 'Changed after issue'
    where id = '30000000-0000-4000-8000-000000000001'$$,
  'P0001', 'Issued documents are read-only.', 'issued documents are read-only');
select throws_ok(
  $$update public.documents set status = 'draft'
    where id = '30000000-0000-4000-8000-000000000001'$$,
  'P0001', 'Issued documents are read-only.', 'issued documents cannot return to draft');
select throws_ok(
  $$delete from public.documents where id = '30000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'documents cannot be deleted');
select throws_ok(
  $$delete from public.businesses where id = '10000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'businesses cannot be deleted');

-- Conversion: only from an issued quotation, and only once.
select throws_ok(
  $$select pg_temp.new_doc('30000000-0000-4000-8000-000000000004', 'invoice',
      '{"source_quotation_id":"30000000-0000-4000-8000-000000000003"}')$$,
  'P0001', 'Only issued quotations of the same business can be converted.',
  'draft quotations cannot be converted');
update public.documents set status = 'issued'
  where id = '30000000-0000-4000-8000-000000000003';
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
update public.businesses set archived = false
  where id = '10000000-0000-4000-8000-000000000001';
select lives_ok(
  $$insert into public.customers (business_id, name)
    values ('10000000-0000-4000-8000-000000000001', 'Welcome back')$$,
  'restored businesses accept records again');

reset role;

-- ─── Logo storage ───
select is(
  (select public from storage.buckets where id = 'business-logos'),
  true, 'the logo bucket is public so logos print on documents');
select is(
  (select file_size_limit from storage.buckets where id = 'business-logos'),
  307200::bigint, 'logos are limited to 300 KB');

select * from finish();
rollback;
