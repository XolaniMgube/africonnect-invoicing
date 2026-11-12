-- Fixed ZAR document discounts are deducted from the line subtotal before VAT.
-- Existing documents retain their values: the discount starts at zero.
begin;
alter table public.documents
  add column discount_amount numeric not null default 0;
alter table public.documents
  drop constraint documents_totals,
  add constraint documents_discount_amount check (
    discount_amount >= 0
    and discount_amount <= subtotal
    and discount_amount = round(discount_amount, 2)
  ),
  add constraint documents_totals check (total = subtotal - discount_amount + tax);
commit;
