# Africonnect Invoicing

An internal app for Africonnect employees who create invoices and quotations on behalf of client businesses. Africonnect operates the app; each selected **client business** issues its own documents to its **customers**.

It runs in one of two modes:

- **Supabase** (shared): employees sign in with their own accounts; records live in a Supabase Postgres database and logos in Supabase Storage. See [Connect Supabase](#connect-supabase).
- **Browser-only demo**: fictional records in the browser’s `localStorage` and a fixed demo login. Used when Supabase isn’t configured, and by the main browser test suite.

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

Without a `.env.local`, the app runs as the **browser-only demo**:

- Email: `user@africonnectsolutions.co.za`
- Password: `User@2026`

Demo access is not secure authentication. Use fictional information only. The session lives in `sessionStorage` and survives refreshes in the same tab. Logging out preserves saved business records. Nothing is deployed or connected to the existing POS.

## Connect Supabase

Setting up a Supabase project takes six steps, all in the Supabase dashboard apart from the first.

1. **Add the keys.** Copy `.env.example` to `.env.local`. Copy (don’t retype) the Project URL and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from **Connect** (top bar) or **Project Settings → API Keys**. Use the _publishable_ key (`sb_publishable_…`); never put the secret/service-role key in this app. Restart `npm run dev`.
2. **Create the tables.** Open **SQL Editor → New query**, paste all of [`supabase/migrations/20261105120000_invoicing_schema.sql`](supabase/migrations/20261105120000_invoicing_schema.sql) and click **Run**. It should finish with “Success. No rows returned”. Run it only once.
   Alternatively use the CLI: `npx supabase login`, `npx supabase link --project-ref <your-project-ref>`, `npx supabase db push`.
3. **(Optional) Add demo data.** To explore with the fictional example businesses, run [`supabase/seed.sql`](supabase/seed.sql) the same way. Skip this for real client data. Running it twice doesn’t duplicate anything.
4. **Close public sign-up.** **Authentication → Sign In / Providers**: turn off **Allow new users to sign up**, and keep **Email** enabled. Under **Authentication → URL Configuration**, set **Site URL** to the address the app will be served from (for now `http://localhost:3000`).
5. **Create each employee’s login.** **Authentication → Users → Add user → Create new user**: enter their email and a password, and leave **Auto Confirm User** ticked.
6. **Give them access.** Creating a login is not enough: only users listed in `public.employees` can see or change anything. In the SQL Editor:

   ```sql
   insert into public.employees (user_id, full_name)
   select id, 'Demo employee' from auth.users
   where email = 'user@africonnectsolutions.co.za';
   ```

   To remove someone’s access, delete their row from `public.employees`, or delete the user under **Authentication → Users**.

Then sign in at `http://localhost:3000/login`. The login page no longer shows demo credentials; the sidebar shows the employee’s name.

`NEXT_PUBLIC_DATA_BACKEND` chooses the mode explicitly: `supabase` or `local`. If it’s unset, the app uses Supabase whenever the URL and key are present. Set it to `supabase` wherever the app is hosted, so a missing key shows an error rather than quietly falling back to browser storage. `NEXT_PUBLIC_` values are compiled into the build, so rebuild after changing them.

### What the database enforces

The browser talks to Supabase directly with the publishable key, which is public by design. Protection comes from row-level security and triggers in the migration, so these rules hold even for someone calling the API by hand:

- Anonymous visitors can read nothing. Signed-in users who aren’t in `public.employees` can read and change nothing.
- Nothing can be deleted through the API (no delete privilege or policy). Businesses and items are archived instead.
- Invoice and quotation numbers are unique per business and type. An employee may type a number (for example to continue from 0123); otherwise the database assigns the next one, one at a time: one more than the highest number used, keeping its zero-padding, after the prefix. A number is taken on the first save of a draft and can be changed while the document is editable.
- Issued invoices and quotations can be edited in place (same number, still issued; no revision history is kept) but can’t return to draft. An invoice converted from a quotation keeps what it copied when the quotation is edited later. The first issue time and issuing employee are recorded and kept through edits.
- A quotation converts into at most one invoice, and only once it is issued. Two employees converting at the same moment end up on the same invoice.
- Documents must use a customer of the same business; customers and items can’t move between businesses; archived businesses accept no new or changed customers, items or documents.
- Business profile rules (required fields, prefixes, VAT number before charging VAT, day ranges, colour) and document totals (`total = subtotal + tax`) are checked again by the database.
- Logos go to the public `business-logos` bucket (PNG/JPEG, 3 MB). Employees can upload; nobody can overwrite or delete. Each upload gets a new file name, so an issued document keeps the logo it was issued with.

The app also guards against employees overwriting each other. Saving a draft only succeeds if nobody else saved it since it was opened; otherwise the employee is asked to refresh. Archive/restore is stored separately from profile edits.

### Local Supabase (optional)

To develop against a disposable copy instead of the hosted project (requires Docker):

```bash
npm run db:start      # local stack on ports 5433x; prints the local URL and publishable key
npm run db:reset      # re-applies the migration and seed
npm run db:test       # database rule tests (supabase/tests)
npm run db:stop
```

Put the printed `API URL` and `Publishable` key in `.env.local`. Local sign-up is disabled as well; create users with the Auth admin API or `supabase/seed.sql`-style SQL, then add them to `public.employees`. `npm run db:seed:generate` rewrites `supabase/seed.sql` after fixture changes.

## Employee workflow

1. Sign in to see all businesses’ documents and counts of businesses, documents and drafts.
2. Open a client-business workspace to search or filter its invoices and quotations.
3. Add a business from the overview or **Client businesses** (saving opens its workspace), or edit an existing profile, logo, banking details, tax and document defaults. Add that business’s customers and reference items/services.
4. Create an invoice or quotation. Choose its customer (or add a new one without leaving the editor), dates and line items. Reference prices can be overridden without changing the catalogue. Add custom lines as needed.
5. Save a draft, return to it later, preview it, or download a draft-marked PDF. Required data is validated for both saving and issuing.
6. Confirm issuance to preserve the document’s issuer, logo, customer, prices, styling and calculated totals. An issued invoice or quotation can be reopened with **Edit invoice** / **Edit quotation** and saved again under the same number, replacing the previous version.
7. Convert an issued quotation into a separately numbered invoice draft. Review the invoice before issuing. Repeated conversion opens the existing linked invoice.
8. Download a real A4 PDF. Short documents fit on one page; longer documents paginate with a running head and repeated table headings on continuation pages, and “Page X of Y” on every page. Drafts carry a “DRAFT · NOT ISSUED” label and a light watermark.

Archiving a business preserves documents and pauses new document/customer/item work until restored. Items can be archived/restored independently. The fictional Moya Event Styling workspace starts empty to exercise empty states.

## Architecture

| Location                     | Responsibility                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `src/app`                    | App Router routes, layouts, metadata and responsive styles                         |
| `src/components`             | Shared controls, Radix dialogs, shell, data provider, navigation guards            |
| `src/features`               | Login, overview, businesses, customer/catalogue management, editor and preview     |
| `src/domain/types.ts`        | Employee, business, customer, item, document and snapshot contracts                |
| `src/domain/documents.ts`    | Scoping, date helpers, calculations, validation, numbering, issuing and conversion |
| `src/domain/businesses.ts`   | Business-profile rules (VAT number before charging VAT, prefixes, day ranges)      |
| `src/data/store.ts`          | The data-backend interface, backend selection and record merging                   |
| `src/data/supabase-store.ts` | Supabase Auth, Postgres and Storage implementation                                 |
| `src/data/local-store.ts`    | Browser-only demo implementation (localStorage + demo sign-in)                     |
| `src/data/rows.ts`           | App record ↔ database row mapping, conversion links; unit tested                   |
| `src/data/errors.ts`         | Plain-language messages for database, sign-in and upload failures                  |
| `src/data/repository.ts`     | Versioned data validation, browser persistence and record operations               |
| `src/data/session.ts`        | Demo-session adapter (browser-only mode)                                           |
| `src/data/fixtures.ts`       | Deterministic fictional fixtures with stable IDs                                   |
| `supabase/`                  | Migration (schema, rules, access), demo seed, database tests, local stack config   |
| `scripts/generate-seed.ts`   | Builds `supabase/seed.sql` from the fixtures                                       |
| `src/pdf/document-pdf.tsx`   | Shared client-business A4 document template and download generation                |
| `src/pdf/layout.ts`          | Pure PDF layout helpers (long-description splitting), unit tested                  |
| `tests`                      | Domain tests and Playwright employee workflows                                     |

The installed Next.js 16.4.5 documentation was consulted, including its App Router, client-component, CSS and Activity state-preservation guidance. The existing Cache Components/Partial Prefetching configuration is retained, which means Next.js keeps up to three recently visited pages alive (hidden) with their state. The app accounts for this:

- Hidden retained pages are excluded from global unsaved-form checks and browser test selectors.
- The new-document editor is keyed on `useRouter().bfcacheId`, so each fresh “Create document” starts blank while browser back/forward still restores an in-progress draft.
- “Add business” opens its dialog in place rather than through a URL flag, so a retained page cannot reopen a stale form.
- Archive/restore and profile saves merge onto the latest saved record, so a retained settings form cannot undo an archive.

The UI uses Tailwind CSS, shared custom controls, Lucide icons, and Radix Dialog (the accessible primitive also used by shadcn/ui). PDF rendering is loaded only when requested. Zod validates records at the repository boundary.

Components never talk to storage directly. They call named, asynchronous actions on the data provider (`saveDocument`, `convertQuotation`, `setBusinessArchived`, …). The provider passes them to the active store (`src/data/store.ts`), and only merges the record into what’s on screen after the store confirms the save. Both stores first run the same domain rules on the records on screen: validation, snapshots, totals and conversion. The Supabase store then writes the result, and the database applies its own rules. The app stays client-rendered and talks to Supabase from the browser (`@supabase/ssr`’s browser client, session kept in cookies). There is no server code or `proxy.ts`; add one if server components ever need the session.

## Data and calculation policies

These apply to both modes unless marked _(browser-only)_.

- _(browser-only)_ Storage key: `africonnect-invoicing:v1`, schema version `1`.
- _(browser-only)_ Businesses, customers, catalogue items, document snapshots, uploaded logos and conversion links are persisted together with one `localStorage.setItem` operation.
- _(browser-only)_ Fixtures initialize only when the storage key is absent. They are deterministic, not appended on refresh. On the first successful write, the complete dataset is persisted.
- _(browser-only)_ Saves update the displayed repository state only after storage succeeds. Quota/permission failures display an error and retain the unsaved form and previous records.
- _(browser-only)_ Malformed or unsupported saved data blocks loading. The app never automatically resets or erases it. The retry action re-reads storage.
- _(browser-only)_ For recovery, preserve a copy of the raw storage value through browser developer tools before making changes. A developer can restore a known-good version-1 value. Clearing the key intentionally resets to fixtures, but loses locally saved work; it is never done automatically.
- _(browser-only)_ Demo-session storage is separate from business data.
- Relationships use stable IDs. Document URLs and React keys use internal IDs; display numbers may legitimately overlap between businesses.
- Each business has independent invoice and quotation sequences. The editor suggests the next number (highest trailing number + 1, same zero-padding, 4 digits for the first; `PREFIX-0124`, or `0124` without a prefix) and accepts any other unused number of up to 40 characters; later documents continue from the highest. Prefix changes keep the numeric sequence.
- Each line’s `quantity × unit price` is rounded to cents. Integer line cents are summed; VAT is rounded once on that subtotal. The editor, records, preview, business page and PDF use the same calculation function.
- Business profiles require a name, contact email and address; invoice and quotation prefixes may be empty (plain numbers) or 1–12 letters, numbers or hyphens, and must differ when set; payment and validity periods are whole days from 0 to 365.
- Tax is optional; a positive VAT rate requires an issuer VAT registration value, both on the business profile and on each document. Documents are labelled Invoice/Quotation, never automatically “Tax invoice”. This is a prototype, not accounting/tax compliance software.
- Issuing deep-copies document identities. Later profile/catalogue edits do not modify issued documents. Converted drafts retain the quotation’s issuer and customer snapshots; explicitly changing the selected customer uses the new customer’s details. Payment dates/terms are regenerated for invoices, and quotation-specific notes are not blindly copied.
- Logo uploads accept PNG/JPEG up to 2,000 × 2,000 pixels: at most 3 MB with Supabase, and 300 KB in browser-only mode (where the image is kept in the browser’s small local storage). A visible preview confirms the chosen image. In browser-only mode the image itself is stored and copied into snapshots; with Supabase it is uploaded immediately and its permanent URL is stored and copied into snapshots.
- With Supabase, a failed save leaves the form as it was, shows why (rule broken, connection lost, session expired, someone else changed it) and changes nothing on screen.

## Validation

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Seventeen unit tests (`npm test`) cover cent rounding, deterministic fixtures, business scoping, independent numbering, immutable snapshots, idempotent conversion, archiving, document and business-profile validation, storage failures, PDF description splitting, Supabase row mapping and conversion links, merging saved records, error messages (including logo storage limits), the hidden due / expiry date, editing issued invoices in place, and chosen numbers, the next number and empty prefixes.

Thirty-two database tests (`npm run db:test`, needs the local stack) check every rule in [What the database enforces](#what-the-database-enforces), acting as an anonymous visitor, a signed-in non-employee and an employee.

Run browser tests against an existing local server:

```bash
# Terminal 1 (browser-only demo build, even if .env.local points at Supabase)
NEXT_PUBLIC_DATA_BACKEND=local npm run build
npm run start -- --hostname 127.0.0.1 --port 3100

# Terminal 2
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 npm run test:e2e
```

The test configuration uses installed Chrome at `/opt/google/chrome/chrome`. Set `PLAYWRIGHT_CHROME_PATH` to another Chrome/Chromium executable when needed. `PLAYWRIGHT_BASE_URL` defaults to `http://127.0.0.1:3001`. Tests use isolated browser contexts and do not modify your normal browser’s records. Screenshots, downloaded PDFs and failure traces go to ignored `test-results/`.

Eight browser workflows cover login/logout and route gating, business document filters, business creation/edit/archive/restore and the VAT-number rule, customer/catalogue creation and scoping, invoice drafting and refresh persistence, calculations, unsaved-change warnings (navigation and business switching), issuance, preserved snapshots, editing an issued invoice under the same number (and cancelling an edit), quotation creation/conversion, repeated-conversion prevention, an empty business with inline customer creation, a fresh editor after saving, short (1-page) and multipage PDF downloads, failed saves, corrupt storage, and no page overflow at desktop/tablet/phone widths (lists become cards on phones).

If a test run behaves strangely, make sure the server on the test port was started after the latest `npm run build`; an older `next start` process serves stale assets.

### Testing against Supabase

`tests/supabase.spec.ts` runs only with `E2E_SUPABASE=1`, against a build that points at a **local or test** Supabase project, never production: it creates businesses and documents, which can’t be deleted. It covers sign-in refusals, logo upload to Storage, database-assigned numbering and continuing from a typed number, issue seen from a second session, editing an issued invoice and refusing a stale second editor’s overwrite, a PDF with the embedded logo, simultaneous conversion by two employees, and the draft-overwrite guard. The default employee is `user@africonnectsolutions.co.za` / `User@2026` (override with `E2E_EMAIL` / `E2E_PASSWORD`). Set `E2E_OUTSIDER_EMAIL` / `E2E_OUTSIDER_PASSWORD` to a user who isn’t in `public.employees` to check that they are refused.

```bash
npm run db:start && npm run db:reset
# create the employee (and optionally an outsider) in the local stack, then:
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54331 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local publishable key> npm run build
npm run start -- --hostname 127.0.0.1 --port 3100
E2E_SUPABASE=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 npm run test:e2e
```

Format source with `npm run format`.

## Branding

The application adapts the supplied Africonnect POS screenshots into an invoicing-focused workspace. The logo icon was downloaded from the [public Africonnect website](https://www.africonnectsolutions.co.za/logo-icon.png). Its public stylesheet includes lime `#A3D955`; the green surfaces and supporting colours are adapted/estimated from the references, not claimed to be official brand tokens. The app uses a local system sans-serif stack without runtime font downloads. Fictional issuer marks are repository-owned PNGs derived from simple lettermark vectors. All fixture contact, registration and banking details are fictional; no screenshot banking details were transcribed.

## Limitations

- _(browser-only)_ Records live in one browser, for one user; there is no sync, collaboration, real access control or backup. Clearing site data removes saved records. Rules such as unique numbers are app rules, not a security boundary against developer-tools edits.
- _(Supabase)_ Changes made by other employees appear when you return to the tab after 30 seconds away or reload; there is no live updating. Last save wins for business, customer and item details (drafts are protected; see above).
- _(Supabase)_ No password reset or invitation emails: an administrator sets and resets passwords in the dashboard. Hosted Supabase’s built-in email sender is rate-limited and not meant for production; configure SMTP before enabling self-service password reset.
- _(Supabase)_ Logos are uploaded as soon as they’re chosen, so a logo picked in a form that is never saved remains in Storage. Logos are public to anyone with the link, by design.
- _(Supabase)_ Back up and restore with Supabase’s tools; the free plan has no point-in-time recovery.
- Navigation warnings cover links, business switching, reload/close and browser history through the Navigation API where available. The browser suite verifies Chromium; other browser engines have not been verified.
- The HTML preview shares the exact document data and arithmetic with the PDF; line wrapping and pagination differ between HTML and A4.
- PDFs use Helvetica rather than embedding the interface font. Extremely long line descriptions are divided at paragraph/word boundaries into “(continued)” rows so ordinary line items stay together; unbroken strings longer than 24 characters (URLs, references) are allowed to wrap. Ordinary words are not hyphenated.
- PDF page chrome uses `@react-pdf/renderer`’s stable pagination engine. In version 4.9, page-number text that is bottom-anchored or shrink-to-fit can be dropped, so the running head and page numbers are top-anchored with fixed widths (see comments in `src/pdf/document-pdf.tsx`). Re-check PDFs after upgrading the library.
- Not included: public registration, multi-organisation onboarding, customer logins, payment processing, email sending, POS integration, deployment and DNS.
