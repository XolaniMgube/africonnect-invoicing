-- Document templates: each business chooses how its invoices and quotations
-- look. Only appearance; numbers, totals and rules are unchanged. Existing
-- businesses keep the Classic look. Issued documents keep the template copied
-- into their snapshot when they were issued.
begin;

alter table public.businesses
  add column template text not null default 'classic'
    constraint businesses_template check (template in ('classic', 'executive')),
  add column secondary_accent text not null default '#C9A45C'
    constraint businesses_secondary_accent check (secondary_accent ~* '^#[0-9a-f]{6}$'),
  add column signatory_name text not null default ''
    constraint businesses_signatory_name check (char_length(signatory_name) <= 60),
  add column signatory_title text not null default ''
    constraint businesses_signatory_title check (char_length(signatory_title) <= 60),
  add column closing_message text not null default 'Thank you for your service!'
    constraint businesses_closing_message check (char_length(closing_message) <= 80);

commit;
