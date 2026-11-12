-- Registration numbers are optional independently of the configured VAT rate.
-- Retain the existing tax_rate range check and all other business constraints.
alter table public.businesses
  drop constraint if exists businesses_vat_number_for_vat;
