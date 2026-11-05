# Africonnect Invoicing

An interactive, browser-local prototype for Africonnect employees who create invoices and quotations on behalf of client businesses. Africonnect operates the app; each selected **client business** issues its own documents to its **customers**.

## Run locally

Requires Node.js 20.9 or newer and npm.

```bash
npm ci
npm run dev
```

Open the Local URL printed by Next.js (normally `http://localhost:3000`). Open `/login` directly, or use `/` and let the demo-session gate redirect you.

For a production build:

```bash
npm run build
npm start
```

No environment variables, Supabase account, external API, or production credentials are required. Nothing is deployed or connected to the existing POS.

**Demo login**

- Email: `user@africonnectsolutions.co.za`
- Password: `User@2026`

This is explicit demo access, not secure authentication. Use fictional information only. The session lives in `sessionStorage` and survives refreshes in the same tab. Logging out preserves saved business records.

## Employee workflow

1. Sign in to see all businesses’ documents and calculated statistics. Issued invoice value excludes drafts and quotations; it is not money received.
2. Search or filter invoices and quotations, or open a client-business workspace.
3. Add a business from the overview or **Client businesses** (saving opens its workspace), or edit an existing profile, logo, banking details, tax and document defaults. Add that business’s customers and reference items/services.
4. Create an invoice or quotation. Choose its customer (or add a new one without leaving the editor), dates and line items. Reference prices can be overridden without changing the catalogue. Add custom lines as needed.
5. Save a draft, return to it later, preview it, or download a draft-marked PDF. Required data is validated for both saving and issuing.
6. Confirm issuance to preserve the document’s issuer, logo, customer, prices, styling and calculated totals. Issued documents are read-only.
7. Convert an issued quotation into a separately numbered invoice draft. Review the invoice before issuing. Repeated conversion opens the existing linked invoice.
8. Download a real A4 PDF. Short documents fit on one page; longer documents paginate with a running head and repeated table headings on continuation pages, and “Page X of Y” on every page. Drafts carry a “DRAFT · NOT ISSUED” label and a light watermark.

Archiving a business preserves documents and pauses new document/customer/item work until restored. Items can be archived/restored independently. The fictional Moya Event Styling workspace starts empty to exercise empty states.

## Architecture

| Location                   | Responsibility                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `src/app`                  | App Router routes, layouts, metadata and responsive styles                         |
| `src/components`           | Shared controls, Radix dialogs, shell, data provider, navigation guards            |
| `src/features`             | Login, overview, businesses, customer/catalogue management, editor and preview     |
| `src/domain/types.ts`      | Employee, business, customer, item, document and snapshot contracts                |
| `src/domain/documents.ts`  | Scoping, date helpers, calculations, validation, numbering, issuing and conversion |
| `src/domain/businesses.ts` | Business-profile rules (VAT number before charging VAT, prefixes, day ranges)      |
| `src/data/repository.ts`   | Versioned data validation, browser persistence and record operations               |
| `src/data/session.ts`      | Isolated demo-session adapter                                                      |
| `src/data/fixtures.ts`     | Deterministic fictional fixtures with stable IDs                                   |
| `src/pdf/document-pdf.tsx` | Shared client-business A4 document template and download generation                |
| `src/pdf/layout.ts`        | Pure PDF layout helpers (long-description splitting), unit tested                  |
| `tests`                    | Domain tests and Playwright employee workflows                                     |

The installed Next.js 16.4.5 documentation was consulted, including its App Router, client-component, CSS and Activity state-preservation guidance. The existing Cache Components/Partial Prefetching configuration is retained, which means Next.js keeps up to three recently visited pages alive (hidden) with their state. The app accounts for this:

- Hidden retained pages are excluded from global unsaved-form checks and browser test selectors.
- The new-document editor is keyed on `useRouter().bfcacheId`, so each fresh “Create document” starts blank while browser back/forward still restores an in-progress draft.
- “Add business” opens its dialog in place rather than through a URL flag, so a retained page cannot reopen a stale form.
- Archive/restore and profile saves merge onto the latest saved record, so a retained settings form cannot undo an archive.

The UI uses Tailwind CSS, shared custom controls, Lucide icons, and Radix Dialog (the accessible primitive also used by shadcn/ui). PDF rendering is loaded only when requested. Zod validates saved records at the repository boundary. The UI calls the provider’s transactional `commit` operation rather than writing local storage directly.

## Data and calculation policies

- Storage key: `africonnect-invoicing:v1`, schema version `1`.
- Businesses, customers, catalogue items, document snapshots, uploaded logos and conversion links are persisted together with one `localStorage.setItem` operation.
- Fixtures initialize only when the storage key is absent. They are deterministic, not appended on refresh. On the first successful write, the complete dataset is persisted.
- Saves update the displayed repository state only after storage succeeds. Quota/permission failures display an error and retain the unsaved form and previous records.
- Malformed or unsupported saved data blocks loading. The app never automatically resets or erases it. The retry action re-reads storage.
- For recovery, preserve a copy of the raw storage value through browser developer tools before making changes. A developer can restore a known-good version-1 value. Clearing the key intentionally resets to fixtures, but loses locally saved work; it is never done automatically.
- Demo-session storage is separate from business data.
- Relationships use stable IDs. Document URLs and React keys use internal IDs; display numbers may legitimately overlap between businesses.
- Each business has independent invoice and quotation sequences. Numbers are reserved on the first successful save/issue. Prefix changes retain a monotonically increasing numeric suffix.
- Each line’s `quantity × unit price` is rounded to cents. Integer line cents are summed; VAT is rounded once on that subtotal. The editor, records, preview, overview and PDF use the same calculation function.
- Business profiles require a name, contact email and address; invoice and quotation prefixes must differ (1–12 letters, numbers or hyphens); payment and validity periods are whole days from 0 to 365.
- Tax is optional; a positive VAT rate requires an issuer VAT registration value, both on the business profile and on each document. Documents are labelled Invoice/Quotation, never automatically “Tax invoice”. This is a prototype, not accounting/tax compliance software.
- Issuing deep-copies document identities. Later profile/catalogue edits do not modify issued documents. Converted drafts retain the quotation’s issuer and customer snapshots; explicitly changing the selected customer uses the new customer’s details. Payment dates/terms are regenerated for invoices, and quotation-specific notes are not blindly copied.
- Logo uploads accept PNG/JPEG, at most 300 KB and 2,000 × 2,000 pixels. A visible preview confirms the chosen image. Uploaded data is included in snapshots.

## Validation

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Ten domain tests (`npm test`) cover cent rounding, deterministic fixtures, business scoping, independent numbering, immutable snapshots, idempotent conversion, archiving, document and business-profile validation, storage failures and PDF description splitting.

Run browser tests against an existing local server:

```bash
# Terminal 1
npm run build
npm run start -- --hostname 127.0.0.1 --port 3100

# Terminal 2
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 npm run test:e2e
```

The test configuration uses installed Chrome at `/opt/google/chrome/chrome`. Set `PLAYWRIGHT_CHROME_PATH` to another Chrome/Chromium executable when needed. `PLAYWRIGHT_BASE_URL` defaults to `http://127.0.0.1:3001`. Tests use isolated browser contexts and do not modify your normal browser’s records. Screenshots, downloaded PDFs and failure traces go to ignored `test-results/`.

Seven browser workflows cover login/logout and route gating, overview filters, business creation/edit/archive/restore and the VAT-number rule, customer/catalogue creation and scoping, invoice drafting and refresh persistence, calculations, unsaved-change warnings (navigation and business switching), issuance, preserved snapshots, quotation creation/conversion, repeated-conversion prevention, an empty business with inline customer creation, a fresh editor after saving, short (1-page) and multipage PDF downloads, failed saves, corrupt storage, and no page overflow at desktop/tablet/phone widths (lists become cards on phones).

If a test run behaves strangely, make sure the server on the test port was started after the latest `npm run build`; an older `next start` process serves stale assets.

Format source with `npm run format`.

## Branding

The application adapts the supplied Africonnect POS screenshots into an invoicing-focused workspace. The logo icon was downloaded from the [public Africonnect website](https://www.africonnectsolutions.co.za/logo-icon.png). Its public stylesheet includes lime `#A3D955`; the green surfaces and supporting colours are adapted/estimated from the references, not claimed to be official brand tokens. The app uses a local system sans-serif stack without runtime font downloads. Fictional issuer marks are repository-owned PNGs derived from simple lettermark vectors. All fixture contact, registration and banking details are fictional; no screenshot banking details were transcribed.

## Prototype limitations and Supabase path

- Browser-local, single-user/single-tab records. No cross-device sync, collaboration, real access control, server storage or document delivery.
- Clearing site data removes saved records; there is no managed backup service.
- Issued read-only behavior is an application invariant, not a security boundary against developer-tools edits.
- Navigation warnings cover links, business switching, reload/close and browser history through the Navigation API where available. The browser suite verifies Chromium; other browser engines have not been verified.
- The HTML preview shares the exact document data and arithmetic with the PDF; line wrapping and pagination differ between HTML and A4.
- PDFs use Helvetica rather than embedding the interface font. Extremely long line descriptions are divided at paragraph/word boundaries into “(continued)” rows so ordinary line items stay together; unbroken strings longer than 24 characters (URLs, references) are allowed to wrap. Ordinary words are not hyphenated.
- PDF page chrome uses `@react-pdf/renderer`’s stable pagination engine. In version 4.9, page-number text that is bottom-anchored or shrink-to-fit can be dropped, so the running head and page numbers are top-anchored with fixed widths (see comments in `src/pdf/document-pdf.tsx`). Re-check PDFs after upgrading the library.
- No public registration, subscriptions, multi-organisation onboarding, customer logins, payment processing, email sending, POS integration, deployment or DNS configuration.

For Supabase, replace `src/data/session.ts` with real Auth, and replace the persistence operations in `src/data/repository.ts`/provider with asynchronous database calls. Keep the domain types, scoping, calculation, snapshot and PDF contracts. Add real employee membership and server-enforced access policies; foreign keys on business/customer/item/document IDs; uniqueness on business/type/number; transactional numbering and conversion; and storage-backed uploaded logos plus immutable issued artifacts. Do not treat the current browser gate as an authentication layer to reuse in production.
# africonnect-invoicing
