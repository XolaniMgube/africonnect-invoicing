# Changelog

## 0.2.0 — 2026-11-05

- Added a Supabase backend: employee sign-in with Supabase Auth, shared records in Postgres, and business logos in Supabase Storage. The browser-only demo remains available (and is what the main e2e suite uses); `NEXT_PUBLIC_DATA_BACKEND` chooses between them.
- Added the database schema (`supabase/migrations`). Only listed employees can read or change records. Nothing can be deleted. Numbers are assigned by the database per business and type. Issued documents are read-only. A quotation converts into at most one invoice. Archived businesses are frozen. Documents must reference a customer of the same business.
- Added optional fictional demo data for Supabase (`supabase/seed.sql`, generated from the same fixtures as the browser demo).
- Saves are now asynchronous with “Saving…” states; buttons can’t submit twice. Database rule violations, lost connections and expired sessions show plain-language messages.
- Two employees editing the same draft: the second save is refused with an explanation instead of silently overwriting. Converting the same quotation from two sessions opens one shared invoice. Archive changes are saved separately from profile edits so they can’t undo each other.
- Records reload when you return to the tab after 30 seconds away.
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
