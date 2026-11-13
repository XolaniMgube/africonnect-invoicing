-- Per-document choice to print unit prices. When false, invoices and
-- quotations show Description, Qty and Total only. Existing documents keep
-- showing prices. Like the rest of an issued document, it can't change after
-- issue (see prepare_document).
alter table public.documents
  add column show_item_prices boolean not null default true;
