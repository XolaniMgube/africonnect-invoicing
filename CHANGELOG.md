# Changelog

## 2026-11-12

- Executive template PDFs: the Contact Us block now appears once, on the last page (with the signature), instead of on every page of a multipage document.

- Added a **Templates** page to the sidebar: browse the templates with usage counts, preview each as an invoice or quotation with fictional sample details, and download a sample PDF. Each business still chooses its template, colours and signature in its settings.

- Added document templates. Each business chooses one in its add/edit form, with a **Preview design** sample: **Classic** (unchanged) or the new **Executive** design, which uses two colours, rounded table header and total, a payment card, a closing message, a Contact Us footer, a handwritten-style signature (signatory name and title) and a striped bottom band. Issued documents keep the template they were issued with. Bundled Poppins and Kristi fonts (OFL). Apply `20261112160000_document_templates.sql` to Supabase.

- Customers and items & services can be deleted (with confirmation). Customers used by any invoice or quotation are kept so those documents stay complete; deleting an item leaves existing document lines unchanged. Item archiving is removed: previously archived items reappear in the catalogue. Apply `20261112150000_delete_customers_items.sql` to Supabase together with deploying this version.

- Drafts are unnumbered until issue. Editing issued invoices or quotations creates linked draft revisions, preserving the original and assigning the next number when the revision is issued. Added database enforcement and migration, with domain and browser coverage.

- Added fixed rand discounts to invoice/quotation creation and editing, saved records, quotation conversion, previews and PDFs. VAT is calculated after the discount; amounts outside zero–subtotal are rejected. Added `20261112130000_document_discounts.sql` for Supabase.

- Removed the default payment period field from add-business and business settings forms, and renamed the registration field to “Business Registration Number”.

- Made VAT registration numbers optional when adding/editing businesses and saving/issuing invoices or quotations with a positive VAT rate. The 0–100 rate validation remains.
- Added `20261112120000_optional_vat_number.sql` to remove the matching Supabase constraint; apply it to existing databases.

## 0.2.0 — 2026-11-05

- Added a Supabase backend: employee sign-in with Supabase Auth, shared records in Postgres, and business logos in Supabase Storage. The browser-only demo remains available (and is what the main e2e suite uses); `NEXT_PUBLIC_DATA_BACKEND` chooses between them.
- Added the database schema (`supabase/migrations`). Only listed employees can read or change records. Nothing can be deleted. Numbers are assigned by the database per business and type. Issued documents are read-only. A quotation converts into at most one invoice. Archived businesses are frozen. Documents must reference a customer of the same business.
- Added optional fictional demo data for Supabase (`supabase/seed.sql`, generated from the same fixtures as the browser demo).
- Saves are now asynchronous with “Saving…” states; buttons can’t submit twice. Database rule violations, lost connections and expired sessions show plain-language messages.
- Two employees editing the same draft: the second save is refused with an explanation instead of silently overwriting. Converting the same quotation from two sessions opens one shared invoice. Archive changes are saved separately from profile edits so they can’t undo each other.
- Records reload when you return to the tab after 30 seconds away.
- Business logos can now be up to 3 MB with Supabase (was 300 KB). Apply `supabase/migrations/20261108120000_larger_logos.sql` to raise the storage bucket’s limit; until it is applied, uploads over 300 KB say that the storage limit needs raising. Browser-only mode keeps 300 KB.
- Issuer logos on document previews and PDFs are 2.5× larger (up to 130 px on screen, 120 pt in the PDF) and keep their own proportions, so wide logos are no longer shrunk to fit a small square.
- The document editor’s customer field is now one searchable dropdown: open it to see the business’s customers, or type to search by name, contact person, email or phone (“No customers match” when nothing does). It replaces the separate “Find a customer” box, and works with the arrow keys, Enter and Esc.
- Removed the “Payment due date” / “Valid until” field from the editor, previews and PDFs; the terms text (e.g. “Payment within 30 days.”) covers it. A date is still stored, following the document date by the business’s payment or validity period, because the database requires one.
- Document lines: the description box is gone (lines that already have a description keep it), and catalogue items are added without theirs. A new “Item total (R)” field sits next to “Unit price (R)”: typing either fills in the other (total = quantity × unit price; unit price = total ÷ quantity), and whichever was typed last stays fixed when the quantity changes. A unit price worked out from a total is kept unrounded, so the line adds up to exactly the total typed.
- Issued invoices and quotations can be edited: **Edit invoice** / **Edit quotation** (beside “Convert to invoice”) reopens the form, and **Save changes** replaces the document under the same number (it stays issued; no revision history is kept). An invoice already converted from a quotation keeps what it copied. Apply `supabase/migrations/20261109120000_editable_issued_invoices.sql` and `20261109140000_editable_issued_quotations.sql`. If two employees edit the same issued document, the second save is refused instead of overwriting the first.
- Businesses may leave the invoice and quotation prefixes empty to number documents as plain digits (0001). The editor has an “Invoice number” / “Quotation number” field, filled with the next number; type another (for example 0123 to continue from existing paper invoices) and later documents continue from the highest number, keeping its zero-padding. A number already used by the business is refused. Apply `supabase/migrations/20261109130000_custom_document_numbers.sql`.
- Removed the issued invoice value from the overview (its card) and from each business’s page (the amount beside the logo), and the “All documents” table from the overview; the three remaining cards share the row. Documents are listed, searched and filtered in each client business’s workspace.
- Removed the sidebar “Quotations” link: it opened the overview with the Quotations tab selected. Quotations are listed under the overview’s Quotations tab and in each business workspace, as before.
- On Vercel the app always expects Supabase: a deployment built without the URL or key shows which variable is missing instead of quietly becoming the browser-only demo.
- The login page, sidebar, help page and footer show demo wording only in browser-only mode; in Supabase mode the signed-in employee’s name is shown.
- Added database tests (pgTAP), unit tests for row mapping, merging and error messages, and an opt-in Supabase browser suite (`E2E_SUPABASE=1`).

## 0.1.0 — 2026-11-04

- Replaced the Next.js starter with the Africonnect employee invoicing prototype.
- Added branded demo login, protected application routes, logout, responsive navigation and business switching.
- Added all-business overview statistics, searchable/filterable invoices and quotations, and business workspaces.
- Added business profile/branding/banking preferences, logo uploads, archive/restore, scoped customer records and a reference-item catalogue.
- Added a shared invoice/quotation editor, validated drafts, per-business numbering, optional VAT, cent-based totals and issue confirmations.
- Preserved issued document snapshots and added linked, repeat-safe quotation conversion to invoice drafts.
- Added on-screen previews and downloadable, issuer-branded A4 PDFs with draft labels, pagination, continuation headings and page numbering.
- Added deterministic fictional businesses, customers and documents, including empty, no-VAT, draft, issued and multipage examples.
- Added versioned, validated browser storage with transactional save feedback and non-destructive load-error handling.
- Added domain and browser tests plus setup, architecture, storage, branding and future-Supabase documentation.
- Fixed PDF pagination: removed the stray blank page on short documents, restored “Page X of Y” numbering, added a running head and repeated table headings on continuation pages, a draft watermark, word-boundary splitting of long descriptions and wrapping of long unbroken strings.
- Aligned the on-screen preview with the PDF (quotation “Prepared for” and “Terms & notes”, payment-detail lines, draft watermark) and made preview text larger.
- Replaced horizontally scrolling tables with card layouts on phones for documents, customers, items and document previews; raised small mobile text sizes.
- Added full breadcrumbs, correct active states for Overview, Quotations and business sections, and redirected signed-in employees away from the login page.
- Added inline customer creation in the document editor, an empty-business prompt, focused validation messages and a guarded “Convert to invoice” action.
- Fixed state retained by Next.js between navigations: a new document now always starts blank, the add-business dialog no longer reopens with a previous form, and profile saves cannot undo an archive.
- Added business-profile validation (VAT number before charging VAT, distinct and valid prefixes, day ranges) with inline errors.
- Kept all work local to this repository; no production services or deployment were configured.
