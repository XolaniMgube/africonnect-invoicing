-- Database rules for Africonnect Invoicing. Run with `npm run db:test`
-- (local Supabase must be running). Everything happens in one transaction
-- that is rolled back, so no test data is left behind.
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

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
    'tax_rate', 15, 'discount_amount', 0,
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

-- ─── Logo storage ───
select is(
  (select public from storage.buckets where id = 'business-logos'),
  true, 'the logo bucket is public so logos print on documents');
select is(
  (select file_size_limit from storage.buckets where id = 'business-logos'),
  3145728::bigint, 'logos are limited to 3 MB');

select * from finish();
rollback;
