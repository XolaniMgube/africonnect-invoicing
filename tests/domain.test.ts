import test from "node:test";
import assert from "node:assert/strict";
import { createFixtures } from "../src/data/fixtures";
import {
  blankDocument,
  calculate,
  clone,
  convertQuotation,
  endDateFor,
  nextNumber,
  reviseDocument,
  saveDocument,
  scoped,
  validateDocument,
} from "../src/domain/documents";
import {
  loadDatabase,
  parseDatabase,
  persistDatabase,
  removeRecord,
  setAccess,
  setRole,
  setSuper,
  STORAGE_KEY,
  upsertBusiness,
  upsertRecord,
} from "../src/data/repository";
import { validateBusiness } from "../src/domain/businesses";
import { splitDescription } from "../src/pdf/layout";
import {
  businessToRow,
  customerToRow,
  documentToRow,
  itemToRow,
  linkConversions,
  rowToBusiness,
  rowToDocument,
  rowToEmployee,
  rowsToDatabase,
} from "../src/data/rows";
import { DESIGN_DEFAULTS, templateOf } from "../src/domain/templates";
import {
  amounts,
  cancelInvoice,
  deletePayment,
  dueDateOf,
  invoiceStatus,
  openInvoices,
  recordPayment,
  restoreInvoice,
  setDueDate,
  summarise,
  checkSend,
  checkMailSettings,
  cancelReminder,
  saToday,
  scheduleReminder,
  autoReminderPlan,
  setAutoRemindersPaused,
  setReminderRules,
} from "../src/domain/receivables";
import {
  defaultMessage,
  defaultReminderMessage,
  emailBody,
  parseRecipients,
  pdfName,
  validateSendRequest,
} from "../supabase/functions/_shared/invoice-email";
import { merge } from "../src/data/store";
import {
  databaseMessage,
  signInMessage,
  storageMessage,
  OFFLINE,
} from "../src/data/errors";
import type { LineItem } from "../src/domain/types";
const item = (price: number, quantity = 1): LineItem => ({
  id: "line",
  name: "Service",
  description: "",
  unit: "Hour",
  price,
  quantity,
});
test("round each line to cents, sum cents, then round VAT once", () => {
  assert.deepEqual(calculate([item(0.335), item(0.335)], 15), {
    subtotal: 0.68,
    tax: 0.1,
    total: 0.78,
  });
  assert.deepEqual(calculate([item(199.99, 3), item(850, 2)], 15), {
    subtotal: 2299.97,
    tax: 345,
    total: 2644.97,
  });
  assert.deepEqual(calculate([item(1.005)], 0), {
    subtotal: 1.01,
    tax: 0,
    total: 1.01,
  });
});
test("stable fixtures, valid storage, separate business contexts and no accidental shared identities", () => {
  const db = createFixtures();
  assert.deepEqual(db, createFixtures());
  assert.deepEqual(parseDatabase(JSON.stringify(db)), db);
  assert.equal(scoped(db.customers, "glen").length, 2);
  assert.ok(scoped(db.items, "green").every((i) => i.businessId === "green"));
  const doc = blankDocument(db.businesses[0], "invoice", db.customers[2]);
  doc.lines = [item(100)];
  assert.throws(() => saveDocument(db, doc), /belonging/);
});
test("numbering is per business and per type; duplicate display numbers are safe", () => {
  let db = createFixtures();
  db.businesses[1].invoicePrefix = "GZ-INV";
  for (const business of db.businesses.slice(0, 2)) {
    const invoice = blankDocument(
      business,
      "invoice",
      db.customers.find((c) => c.businessId === business.id),
    );
    invoice.lines = [item(100)];
    db = saveDocument(db, invoice, true);
    assert.equal(
      db.documents.find((d) => d.id === invoice.id)?.number,
      "GZ-INV-0004",
    );
    const quote = blankDocument(
      business,
      "quotation",
      db.customers.find((c) => c.businessId === business.id),
    );
    quote.lines = [item(100)];
    db = saveDocument(db, quote, true);
    assert.ok(
      db.documents.find((d) => d.id === quote.id)?.number.endsWith("-0002"),
    );
  }
  assert.equal(
    new Set(db.documents.map((d) => d.id)).size,
    db.documents.length,
  );
});
test("issuing snapshots all identities and prices; later profile, customer and item edits cannot rewrite them", () => {
  let db = createFixtures();
  const draft = clone(db.documents.find((d) => d.status === "draft")!);
  db = saveDocument(db, draft, true);
  const issued = clone(db.documents.find((d) => d.id === draft.id)!);
  db = upsertBusiness(db, {
    ...db.businesses[0],
    name: "Changed business",
    logo: "",
    bank: "New bank",
    accent: "#112233",
  });
  db = upsertRecord(db, "customers", {
    ...db.customers[0],
    name: "Changed customer",
  });
  db = upsertRecord(db, "items", { ...db.items[0], price: 1 });
  assert.deepEqual(
    db.documents.find((d) => d.id === issued.id),
    issued,
  );
  assert.throws(
    () => saveDocument(db, { ...issued, notes: "overwritten" }),
    /Issued documents are preserved/g,
  );
});
test("issued originals are immutable and revisions receive the next number only on issue", () => {
  let db = createFixtures();
  for (const kind of ["invoice", "quotation"] as const) {
    const original = clone(
      db.documents.find((d) => d.kind === kind && d.status === "issued")!,
    );
    assert.throws(
      () => saveDocument(db, { ...original, notes: "overwrite" }, true),
      /preserved/,
    );
    const next = nextNumber(db.documents, db.businesses[0], kind);
    const draft = reviseDocument(original);
    draft.lines = [item(50, 2)];
    db = saveDocument(db, draft);
    assert.equal(db.documents.find((d) => d.id === draft.id)!.number, "");
    assert.equal(nextNumber(db.documents, db.businesses[0], kind), next);
    assert.deepEqual(
      db.documents.find((d) => d.id === original.id),
      original,
    );
    db = saveDocument(db, draft, true);
    const revision = db.documents.find((d) => d.id === draft.id)!;
    assert.equal(revision.number, next);
    assert.equal(revision.revisionOfId, original.id);
    assert.equal(revision.totals.subtotal, 100);
    assert.deepEqual(
      db.documents.find((d) => d.id === original.id),
      original,
    );
    const second = reviseDocument(revision);
    db = saveDocument(db, second, true);
    assert.notEqual(db.documents.find((d) => d.id === second.id)!.number, next);
    assert.equal(documentToRow(second).revision_of_id, revision.id);
    assert.equal(
      parseDatabase(JSON.stringify(db)).documents.find(
        (d) => d.id === second.id,
      )!.revisionOfId,
      revision.id,
    );
    assert.throws(
      () =>
        saveDocument(db, {
          ...reviseDocument(original),
          revisionOfId: "missing",
        }),
      /revision must refer/,
    );
  }
});
test("quoted identities survive conversion and issue; duplicate conversion opens the same invoice", () => {
  const db = createFixtures();
  const quote = clone(
    db.documents.find((d) => d.kind === "quotation" && d.status === "issued")!,
  );
  db.businesses[0].name = "New name";
  db.businesses[0].bank = "Different bank";
  db.customers.find((c) => c.id === quote.customerId)!.name =
    "New customer name";
  const first = convertQuotation(db, quote.id);
  const invoice = first.db.documents.find((d) => d.id === first.invoiceId)!;
  assert.equal(invoice.kind, "invoice");
  assert.equal(invoice.status, "draft");
  assert.equal(invoice.sourceQuotationId, quote.id);
  assert.deepEqual(invoice.snapshot, quote.snapshot);
  assert.deepEqual(invoice.lines, quote.lines);
  assert.equal(invoice.taxRate, quote.taxRate);
  assert.notEqual(invoice.number, quote.number);
  assert.doesNotMatch(invoice.terms, /valid/i);
  const again = convertQuotation(first.db, quote.id);
  assert.equal(again.invoiceId, first.invoiceId);
  assert.equal(again.db.documents.length, first.db.documents.length);
  const issuedDb = saveDocument(first.db, invoice, true);
  assert.deepEqual(
    issuedDb.documents.find((d) => d.id === invoice.id)!.snapshot,
    quote.snapshot,
  );
  assert.deepEqual(
    {
      ...first.db.documents.find((d) => d.id === quote.id),
      linkedInvoiceId: undefined,
    },
    { ...quote, linkedInvoiceId: undefined },
  );
});
test("archives preserve history and block new or edited work until restored", () => {
  let db = createFixtures();
  const draft = db.documents.find((d) => d.status === "draft")!;
  const count = db.documents.length;
  db = upsertBusiness(db, { ...db.businesses[0], archived: true });
  assert.equal(db.documents.length, count);
  assert.throws(() => saveDocument(db, draft), /Restore/);
  assert.throws(() => convertQuotation(db, "glen-doc-3"), /Restore/);
  assert.throws(() => upsertRecord(db, "items", db.items[0]), /Restore/);
  db = upsertBusiness(db, { ...db.businesses[0], archived: false });
  assert.doesNotThrow(() => saveDocument(db, draft));
});
test("customers and items can be deleted; customers used by documents are kept", () => {
  const db = createFixtures();
  const item = db.items.find((i) => i.businessId === "glen")!;
  const usedLine = db.documents.find((d) =>
    d.lines.some((l) => l.referenceId === item.id),
  )!;
  const withoutItem = removeRecord(db, "items", item.id);
  assert.equal(withoutItem.items.length, db.items.length - 1);
  // Lines copy item details, so documents are unchanged and still load.
  assert.deepEqual(withoutItem.documents, db.documents);
  assert.ok(usedLine);
  assert.doesNotThrow(() => parseDatabase(JSON.stringify(withoutItem)));
  // A customer with documents (draft or issued) cannot be deleted.
  const used = db.customers.find((c) =>
    db.documents.some((d) => d.customerId === c.id),
  )!;
  assert.throws(
    () => removeRecord(db, "customers", used.id),
    /can’t be deleted because .* invoices or quotations use this customer/,
  );
  const unused = { ...used, id: "unused-customer", name: "Unused" };
  const added = upsertRecord(db, "customers", unused);
  const withoutCustomer = removeRecord(added, "customers", unused.id);
  assert.deepEqual(withoutCustomer.customers, db.customers);
  assert.throws(() => removeRecord(db, "items", "missing"), /no longer exists/);
  const archived = upsertBusiness(db, { ...db.businesses[0], archived: true });
  assert.throws(() => removeRecord(archived, "items", item.id), /Restore/);
});
test("items saved before archiving was removed still load", () => {
  const db = createFixtures();
  const legacy = JSON.parse(JSON.stringify(db));
  legacy.items[0].archived = true;
  const loaded = parseDatabase(JSON.stringify(legacy));
  assert.deepEqual(loaded.items, db.items);
});
test("document templates: defaults for older records, validation and snapshots", () => {
  const db = createFixtures();
  const legacy = JSON.parse(JSON.stringify(db));
  for (const b of legacy.businesses)
    for (const key of Object.keys(DESIGN_DEFAULTS)) delete b[key];
  for (const d of legacy.documents)
    for (const key of Object.keys(DESIGN_DEFAULTS))
      delete d.snapshot.issuer[key];
  const loaded = parseDatabase(JSON.stringify(legacy));
  assert.equal(loaded.businesses[0].template, "classic");
  assert.equal(loaded.businesses[0].secondaryAccent, "#C9A45C");
  assert.equal(
    loaded.businesses[0].closingMessage,
    "Thank you for your service!",
  );
  assert.equal(loaded.documents[0].snapshot.issuer.template, "classic");
  // Supabase rows and snapshots saved before the templates migration.
  const row = businessToRow(db.businesses[0]) as Record<string, unknown>;
  for (const key of [
    "template",
    "secondary_accent",
    "signatory_name",
    "signatory_title",
    "closing_message",
  ])
    delete row[key];
  assert.deepEqual(rowToBusiness(row as never), {
    ...db.businesses[0],
    ...DESIGN_DEFAULTS,
  });
  const docRow = documentToRow(db.documents[0]);
  const issuer = docRow.snapshot.issuer as Partial<
    typeof docRow.snapshot.issuer
  >;
  delete issuer.template;
  delete issuer.secondaryAccent;
  assert.equal(rowToDocument(docRow).snapshot.issuer.template, "classic");
  assert.equal(templateOf({ template: "unknown" as never }), "classic");

  const executive = {
    ...db.businesses[0],
    template: "executive" as const,
    signatoryName: "T. Example",
  };
  assert.deepEqual(validateBusiness(executive), []);
  assert.deepEqual(
    validateBusiness({
      ...executive,
      template: "fancy" as never,
      secondaryAccent: "gold",
      closingMessage: "x".repeat(81),
      signatoryTitle: "y".repeat(61),
    }),
    [
      "Choose a document template.",
      "Choose a valid second document colour.",
      "Keep the closing message to 80 characters or fewer.",
      "Signatory title: use 60 characters or fewer.",
    ],
  );
  // Issuing copies the template; changing the business later doesn't alter it.
  let next = upsertBusiness(db, executive);
  const draft = next.documents.find(
    (d) => d.status === "draft" && d.businessId === executive.id,
  )!;
  next = saveDocument(next, draft, true);
  next = upsertBusiness(next, { ...executive, template: "classic" });
  assert.equal(
    next.documents.find((d) => d.id === draft.id)!.snapshot.issuer.template,
    "executive",
  );
});
test("hiding item prices is saved, defaults to shown and carries into revisions and conversions", () => {
  let db = createFixtures();
  // Records saved before the option existed show prices.
  const legacy = JSON.parse(JSON.stringify(db));
  for (const d of legacy.documents) delete d.showItemPrices;
  assert.ok(
    parseDatabase(JSON.stringify(legacy)).documents.every(
      (d) => d.showItemPrices,
    ),
  );
  const row = documentToRow(db.documents[0]) as Record<string, unknown>;
  delete row.show_item_prices;
  assert.equal(rowToDocument(row as never).showItemPrices, true);

  const quote = db.documents.find(
    (d) => d.kind === "quotation" && d.status === "draft",
  )!;
  const before = calculate(quote.lines, quote.taxRate, quote.discountAmount);
  db = saveDocument(db, { ...quote, showItemPrices: false }, true);
  const issued = db.documents.find((d) => d.id === quote.id)!;
  assert.equal(issued.showItemPrices, false);
  assert.deepEqual(issued.totals, before);
  assert.equal(documentToRow(issued).show_item_prices, false);
  assert.equal(reviseDocument(issued).showItemPrices, false);
  const { db: converted, invoiceId } = convertQuotation(db, quote.id);
  assert.equal(
    converted.documents.find((d) => d.id === invoiceId)!.showItemPrices,
    false,
  );
});
test("roles, super businesses and access", () => {
  let db = createFixtures();
  assert.deepEqual(
    db.employees.map((e) => e.role),
    ["admin", "staff"],
  );
  // Older browser data gets the demo users and no access rows.
  const legacy = JSON.parse(JSON.stringify(db));
  delete legacy.employees;
  delete legacy.access;
  for (const b of legacy.businesses) delete b.isSuper;
  const loaded = parseDatabase(JSON.stringify(legacy));
  assert.equal(loaded.employees.length, 2);
  assert.deepEqual(loaded.access, []);
  assert.equal(loaded.businesses[0].isSuper, false);

  db = setSuper(db, "glen", true);
  assert.equal(db.businesses.find((b) => b.id === "glen")!.isSuper, true);
  assert.equal(businessToRow(db.businesses[0]).is_super, true);
  // Profile edits keep the flag; it only changes through setSuper.
  db = upsertBusiness(db, { ...db.businesses[0], phone: "+27 00 000 0999" });
  assert.equal(db.businesses[0].isSuper, true);

  db = setAccess(db, "glen", "demo-staff", true);
  db = setAccess(db, "glen", "demo-staff", true);
  assert.deepEqual(db.access, [{ businessId: "glen", userId: "demo-staff" }]);
  assert.doesNotThrow(() => parseDatabase(JSON.stringify(db)));
  db = setAccess(db, "glen", "demo-staff", false);
  assert.deepEqual(db.access, []);
  assert.throws(
    () => setAccess(db, "glen", "nobody", true),
    /no longer exists/,
  );

  assert.throws(
    () => setRole(db, "demo-employee", "staff"),
    /Keep at least one admin/,
  );
  db = setRole(db, "demo-staff", "admin");
  db = setRole(db, "demo-employee", "staff");
  assert.deepEqual(
    db.employees.map((e) => e.role),
    ["staff", "admin"],
  );
  // Supabase rows saved before the roles update count as Staff.
  assert.equal(
    rowToEmployee({ user_id: "u1", full_name: "Old row" }).role,
    "staff",
  );
});
test("payments, due dates, cancelling and superseded invoices", () => {
  let db = createFixtures();
  const draft = db.documents.find(
    (d) =>
      d.businessId === "glen" && d.kind === "invoice" && d.status === "draft",
  )!;
  db = saveDocument(
    db,
    { ...draft, date: "2026-11-01", endDate: "2026-12-01" },
    true,
  );
  const inv = db.documents.find((d) => d.id === draft.id)!;
  const total = inv.totals.total;
  const pay = (amount: number, id = crypto.randomUUID()) => ({
    id,
    documentId: inv.id,
    amount,
    paidOn: "2026-11-10",
    method: "eft" as const,
    reference: "",
  });

  // Ordinary businesses: no payments, status stays "issued".
  assert.equal(invoiceStatus(db, inv, "2026-11-15"), "issued");
  assert.throws(() => recordPayment(db, pay(10)), /super businesses/);

  db = setSuper(db, "glen", true);
  assert.equal(invoiceStatus(db, inv, "2026-11-15"), "unpaid");
  assert.equal(invoiceStatus(db, inv, "2026-12-02"), "overdue");

  db = recordPayment(db, pay(100, "p1"));
  assert.equal(invoiceStatus(db, inv, "2026-11-15"), "partial");
  assert.deepEqual(amounts(db, inv), {
    paid: 100,
    balance: (Math.round(total * 100) - 10000) / 100,
  });
  assert.throws(() => recordPayment(db, pay(total)), /more than the balance/);
  assert.throws(() => recordPayment(db, pay(0)), /greater than zero/);
  assert.throws(() => recordPayment(db, pay(1.234)), /two decimal places/);
  assert.throws(
    () => recordPayment(db, { ...pay(1), paidOn: "2999-01-01" }),
    /future/,
  );
  // Can't cancel or revise while payments exist.
  assert.throws(() => cancelInvoice(db, inv.id, ""), /payments recorded/);
  assert.throws(
    () => saveDocument(db, reviseDocument(inv)),
    /payments recorded/,
  );
  db = recordPayment(db, pay(amounts(db, inv).balance));
  assert.equal(invoiceStatus(db, inv, "2027-01-01"), "paid");
  assert.equal(amounts(db, inv).balance, 0);

  db = deletePayment(db, "p1");
  assert.equal(invoiceStatus(db, inv, "2026-11-15"), "partial");

  // Due date: changed separately; the invoice itself stays unchanged.
  db = setDueDate(db, inv.id, "2026-12-31");
  assert.equal(dueDateOf(db, inv), "2026-12-31");
  assert.equal(
    db.documents.find((d) => d.id === inv.id)!.endDate,
    "2026-12-01",
  );
  assert.throws(
    () => setDueDate(db, inv.id, "2026-10-01"),
    /before the invoice date/,
  );
  assert.doesNotThrow(() => parseDatabase(JSON.stringify(db)));

  // Cancel and restore an unpaid invoice.
  db = { ...db, payments: [] };
  db = cancelInvoice(db, inv.id, "Duplicate");
  assert.equal(invoiceStatus(db, inv), "cancelled");
  assert.throws(() => recordPayment(db, pay(1)), /Restore this invoice/);
  db = restoreInvoice(db, inv.id);
  assert.notEqual(invoiceStatus(db, inv), "cancelled");

  // Issuing a revision supersedes the original (any business).
  const revision = reviseDocument(inv);
  db = saveDocument(db, revision);
  db = saveDocument(
    db,
    db.documents.find((d) => d.id === revision.id)!,
    true,
  );
  assert.equal(invoiceStatus(db, inv), "superseded");
  assert.throws(() => recordPayment(db, pay(1)), /replaced by a revision/);
  // Older data without payments loads.
  const legacy = JSON.parse(JSON.stringify(db));
  delete legacy.payments;
  delete legacy.tracking;
  assert.deepEqual(parseDatabase(JSON.stringify(legacy)).payments, []);
});
test("receivables: open invoices, overdue ages and totals per customer", () => {
  let db = setSuper(createFixtures(), "glen", true);
  const issued = db.documents.filter(
    (d) =>
      d.businessId === "glen" && d.kind === "invoice" && d.status === "issued",
  );
  assert.equal(issued.length, 2);
  const [a, b] = issued;
  db = setDueDate(db, a.id, "2026-12-01");
  db = setDueDate(db, b.id, "2026-12-01");
  // Nothing from ordinary businesses, quotations or drafts.
  assert.deepEqual(
    openInvoices(db, "2026-11-20")
      .map((r) => r.doc.id)
      .sort(),
    [a.id, b.id].sort(),
  );
  let rows = openInvoices(db, "2026-11-20");
  assert.ok(rows.every((r) => r.bucket === "current" && r.daysOverdue === 0));

  db = recordPayment(db, {
    id: "p1",
    documentId: a.id,
    amount: 1000,
    paidOn: "2026-11-10",
    method: "eft",
    reference: "",
  });
  rows = openInvoices(db, "2027-01-15"); // 45 days after the due date
  assert.ok(rows.every((r) => r.bucket === "31-60" && r.daysOverdue === 45));
  const totals = summarise(rows);
  const expected =
    (Math.round(a.totals.total * 100) -
      100000 +
      Math.round(b.totals.total * 100)) /
    100;
  assert.equal(totals.outstanding, expected);
  assert.equal(totals.overdue, expected);
  assert.equal(totals.overdueCount, 2);
  assert.equal(totals.buckets.find((x) => x.id === "31-60")!.amount, expected);
  assert.equal(
    totals.customers.reduce((sum, c) => sum + c.count, 0),
    2,
  );
  assert.equal(summarise(openInvoices(db, "2027-03-15")).buckets[3].count, 2);
  // Paid and cancelled invoices drop out.
  db = recordPayment(db, {
    id: "p2",
    documentId: a.id,
    amount: amounts(db, a).balance,
    paidOn: "2026-11-11",
    method: "eft",
    reference: "",
  });
  db = cancelInvoice(db, b.id, "");
  assert.deepEqual(openInvoices(db, "2027-01-15"), []);
});
test("invoice emails: recipients, wording, escaping and send checks", () => {
  assert.deepEqual(parseRecipients(" a@x.co.za, b@y.com;A@x.co.za  c@z.org "), [
    "a@x.co.za",
    "b@y.com",
    "c@z.org",
  ]);
  const ok = {
    documentId: "d",
    to: ["a@x.co.za"],
    cc: [],
    subject: "Invoice",
    message: "Hi",
  };
  assert.deepEqual(validateSendRequest(ok), []);
  assert.deepEqual(validateSendRequest({ ...ok, to: [] }), [
    "Add at least one recipient.",
  ]);
  assert.match(
    validateSendRequest({ ...ok, cc: ["not-an-email"] }).join(),
    /not-an-email/,
  );
  assert.match(
    validateSendRequest({
      ...ok,
      to: Array.from({ length: 11 }, (_, i) => `p${i}@x.co.za`),
    }).join(),
    /at most 10/,
  );
  const message = defaultMessage({
    number: "INV-0001",
    customerName: "Phelang",
    contact: "",
    businessName: "Neno Kweli",
    total: 3000,
    balance: 1500,
  });
  assert.match(message, /Good day Phelang/);
  assert.match(message, /R\s?3\s?000,00, of which R\s?1\s?500,00 is still due/);
  const body = emailBody({
    message: "Hello <b>you</b>\n\nSecond & last",
    number: "INV-0001",
    businessName: "Neno Kweli",
    balance: 1500,
    dueDate: "2026-12-01",
  });
  assert.match(body.html, /Hello &lt;b&gt;you&lt;\/b&gt;/);
  assert.match(body.html, /Second &amp; last/);
  assert.match(body.text, /Balance due R\s?1\s?500,00 · Due 2026-12-01/);
  assert.equal(pdfName("INV/0001 a"), "Invoice-INV-0001-a.pdf");

  // The app checks before calling the email service.
  let db = setSuper(createFixtures(), "glen", true);
  const inv = db.documents.find(
    (d) =>
      d.businessId === "glen" && d.kind === "invoice" && d.status === "issued",
  )!;
  const request = { ...ok, documentId: inv.id };
  assert.throws(() => checkSend(db, request), /Send invoices from/);
  db = upsertBusiness(db, {
    ...db.businesses.find((b) => b.id === "glen")!,
    emailFrom: "info@africonnectsolutions.co.za",
  });
  assert.equal(checkSend(db, request).id, inv.id);
  assert.throws(
    () => upsertBusiness(db, { ...db.businesses[0], emailFrom: "nope" }),
    /must be an email address/,
  );
  db = cancelInvoice(db, inv.id, "");
  assert.throws(() => checkSend(db, request), /cancelled/);
  assert.throws(
    () => checkSend(setSuper(db, "glen", false), request),
    /super businesses/,
  );
});
test("own-mailbox settings: super businesses only, password kept once saved", () => {
  let db = createFixtures();
  const settings = {
    businessId: "glen",
    host: "mail.africonnectsolutions.co.za",
    port: 465,
    username: "info@africonnectsolutions.co.za",
    password: "secret",
  };
  assert.throws(() => checkMailSettings(db, settings), /super businesses/);
  db = setSuper(db, "glen", true);
  assert.equal(checkMailSettings(db, settings).id, "glen");
  assert.throws(
    () => checkMailSettings(db, { ...settings, password: "" }),
    /Enter the mailbox password/,
  );
  assert.throws(
    () => checkMailSettings(db, { ...settings, port: 25 }),
    /Use port 465/,
  );
  assert.throws(
    () => checkMailSettings(db, { ...settings, host: "not a host" }),
    /outgoing mail server/,
  );
  assert.throws(
    () => checkMailSettings(db, { ...settings, username: "info" }),
    /full email address/,
  );
  // Once saved, an empty password means "keep it".
  db = {
    ...db,
    mailSettings: [
      {
        businessId: "glen",
        host: settings.host,
        port: 465,
        username: settings.username,
        updatedAt: "2026-11-14T08:00:00Z",
      },
    ],
  };
  assert.doesNotThrow(() =>
    checkMailSettings(db, { ...settings, password: "" }),
  );
  assert.doesNotThrow(() => parseDatabase(JSON.stringify(db)));
});
test("reminders: scheduling rules and automatic cancellation", () => {
  let db = setSuper(createFixtures(), "glen", true);
  const inv = db.documents.find(
    (d) =>
      d.businessId === "glen" && d.kind === "invoice" && d.status === "issued",
  )!;
  const input = (id: string, sendOn = saToday()) => ({
    id,
    documentId: inv.id,
    sendOn,
    recipients: ["client@customer.example"],
    cc: [],
    subject: "Reminder",
    message: defaultReminderMessage({
      number: inv.number,
      customerName: "Mahlangu",
      contact: "",
      businessName: "Glen",
    }),
  });
  assert.throws(() => scheduleReminder(db, input("r1")), /Send invoices from/);
  db = upsertBusiness(db, {
    ...db.businesses.find((b) => b.id === "glen")!,
    emailFrom: "accounts@africonnectsolutions.co.za",
  });
  assert.throws(
    () => scheduleReminder(db, input("r1", "2020-01-01")),
    /today or a later/,
  );
  assert.throws(
    () => scheduleReminder(db, { ...input("r1"), recipients: [] }),
    /at least one recipient/,
  );
  db = scheduleReminder(db, input("r1"));
  db = scheduleReminder(db, input("r2", "2099-12-31"));
  assert.deepEqual(
    db.reminders.map((r) => [r.id, r.status, r.businessId]),
    [
      ["r1", "scheduled", "glen"],
      ["r2", "scheduled", "glen"],
    ],
  );
  assert.doesNotThrow(() => parseDatabase(JSON.stringify(db)));
  db = cancelReminder(db, "r1");
  assert.equal(db.reminders[0].error, "Cancelled by an admin.");
  assert.throws(() => cancelReminder(db, "r1"), /Only a scheduled reminder/);

  // A part-payment keeps it; paying in full cancels it.
  db = recordPayment(db, {
    id: "p1",
    documentId: inv.id,
    amount: 100,
    paidOn: "2026-11-10",
    method: "eft",
    reference: "",
  });
  assert.equal(db.reminders[1].status, "scheduled");
  db = recordPayment(db, {
    id: "p2",
    documentId: inv.id,
    amount: amounts(db, inv).balance,
    paidOn: "2026-11-10",
    method: "eft",
    reference: "",
  });
  assert.deepEqual(
    [db.reminders[1].status, db.reminders[1].error],
    ["cancelled", "Not sent: the invoice was paid."],
  );
  assert.throws(() => scheduleReminder(db, input("r3")), /already paid/);

  // Cancelling the invoice cancels its reminders.
  db = { ...db, payments: [] };
  db = scheduleReminder(db, input("r4"));
  db = cancelInvoice(db, inv.id, "");
  assert.equal(
    db.reminders.find((r) => r.id === "r4")!.error,
    "Not sent: the invoice was cancelled.",
  );
  // The default message has no amounts: the balance is added when it's sent.
  assert.doesNotMatch(input("x").message, /R\s?\d/);
  // Older data without reminders loads.
  const legacy = JSON.parse(JSON.stringify(db));
  delete legacy.reminders;
  assert.deepEqual(parseDatabase(JSON.stringify(legacy)).reminders, []);
});
test("automatic reminders: rules, pause and the plan shown on an invoice", () => {
  let db = setSuper(createFixtures(), "glen", true);
  const inv = db.documents.find(
    (d) =>
      d.businessId === "glen" && d.kind === "invoice" && d.status === "issued",
  )!;
  assert.throws(
    () => setReminderRules(db, "green", true, [0]),
    /super businesses/,
  );
  assert.throws(
    () => setReminderRules(db, "glen", true, [0]),
    /Send invoices from/,
  );
  db = upsertBusiness(db, {
    ...db.businesses.find((b) => b.id === "glen")!,
    emailFrom: "accounts@africonnectsolutions.co.za",
  });
  assert.throws(
    () => setReminderRules(db, "glen", true, []),
    /at least one day/,
  );
  assert.throws(
    () => setReminderRules(db, "glen", true, [400]),
    /a year after/,
  );
  assert.equal(autoReminderPlan(db, inv), null); // off by default
  db = setReminderRules(db, "glen", true, [14, 0, 7, 7]);
  assert.deepEqual(
    db.businesses.find((b) => b.id === "glen")!.reminderOffsets,
    [0, 7, 14],
  );
  // Profile edits keep the rules.
  db = upsertBusiness(db, {
    ...db.businesses.find((b) => b.id === "glen")!,
    phone: "1",
  });
  assert.equal(db.businesses.find((b) => b.id === "glen")!.autoReminders, true);

  db = setDueDate(db, inv.id, "2026-12-01");
  let plan = autoReminderPlan(db, inv, "2026-12-10")!;
  assert.deepEqual(
    plan.steps.map((s) => [s.date, s.state]),
    [
      ["2026-12-01", "missed"], // more than 3 days ago, never sent
      ["2026-12-08", "upcoming"], // within the catch-up window
      ["2026-12-15", "upcoming"],
    ],
  );
  assert.equal(plan.recipient, "accounts0@glen-customer.example");
  assert.equal(plan.blocker, "");
  // A sent automatic reminder shows against its rule.
  db = {
    ...db,
    reminders: [
      {
        id: "a7",
        documentId: inv.id,
        businessId: "glen",
        sendOn: "2026-12-08",
        recipients: [],
        cc: [],
        subject: "",
        message: "",
        status: "sent",
        error: "",
        ruleOffset: 7,
        createdAt: "",
      },
    ],
  };
  plan = autoReminderPlan(db, inv, "2026-12-10")!;
  assert.equal(plan.steps[1].state, "sent");
  db = setAutoRemindersPaused(db, inv.id, true);
  assert.equal(autoReminderPlan(db, inv)!.paused, true);
  // No customer email: flagged.
  db = {
    ...db,
    customers: db.customers.map((c) =>
      c.id === inv.customerId ? { ...c, email: "" } : c,
    ),
  };
  assert.match(autoReminderPlan(db, inv)!.blocker, /has no email address/);
  assert.doesNotThrow(() => parseDatabase(JSON.stringify(db)));
});
test("invalid dates, prices, quantities, tax and missing issuer details are rejected", () => {
  const db = createFixtures();
  const doc = clone(db.documents[0]);
  doc.lines = [item(-1, 0)];
  doc.taxRate = 101;
  doc.date = "2026-02-30";
  doc.endDate = "2026-01-01";
  doc.snapshot.issuer.address = "";
  doc.customerId = "";
  assert.ok(validateDocument(doc).length >= 6);
  const noVat = clone(db.documents.find((d) => d.businessId === "green")!);
  noVat.taxRate = 15;
  assert.deepEqual(validateDocument(noVat), []);
  for (const kind of ["invoice", "quotation"] as const) {
    const draft = blankDocument(
      db.businesses.find((b) => b.id === "green")!,
      kind,
      db.customers.find((c) => c.businessId === "green"),
    );
    draft.taxRate = 15;
    draft.lines = [item(100)];
    const saved = saveDocument(db, draft, true).documents.find(
      (d) => d.id === draft.id,
    )!;
    assert.equal(saved.snapshot.issuer.vat, "");
    assert.equal(saved.status, "issued");
    assert.equal(saved.totals.tax, 15);
    assert.equal(saved.totals.total, 115);
  }
});
test("storage failures do not report success, mutate prior state or erase malformed data", () => {
  const db = createFixtures();
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, val: string) => {
      values.set(key, val);
    },
  };
  const loaded = loadDatabase(storage);
  persistDatabase(storage, loaded);
  assert.deepEqual(loadDatabase(storage), db);
  const before = values.get(STORAGE_KEY);
  const broken = {
    ...storage,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  assert.throws(() => persistDatabase(broken, db), /not saved/);
  assert.equal(values.get(STORAGE_KEY), before);
  values.set(STORAGE_KEY, "{bad");
  assert.throws(() => loadDatabase(storage), /not been changed/);
  assert.equal(values.get(STORAGE_KEY), "{bad");
  assert.throws(
    () =>
      loadDatabase({
        ...storage,
        getItem: () => {
          throw new Error("SecurityError");
        },
      }),
    /not been changed/,
  );
  assert.throws(() => parseDatabase(JSON.stringify({ ...db, version: 2 })));
  assert.throws(() =>
    parseDatabase(JSON.stringify({ ...db, businesses: [{ id: "broken" }] })),
  );
});
test("business profiles allow optional VAT numbers and require distinct, valid prefixes", () => {
  const db = createFixtures();
  const green = db.businesses.find((b) => b.id === "green")!;
  assert.deepEqual(validateBusiness(green), []);
  for (const vat of ["", "   ", "DEMO-VAT-123"]) {
    const business = { ...green, taxRate: 15, vat };
    assert.deepEqual(validateBusiness(business), []);
    assert.doesNotThrow(() => upsertBusiness(db, business));
    assert.doesNotThrow(() =>
      upsertBusiness(db, { ...business, id: `new-${vat}` }),
    );
  }
  for (const taxRate of [-1, 101, NaN, Infinity]) {
    assert.match(validateBusiness({ ...green, taxRate }).join(" "), /VAT rate/);
  }
  assert.match(
    validateBusiness({ ...green, quotationPrefix: "gg-inv" }).join(" "),
    /different invoice and quotation prefixes/,
  );
  assert.match(
    validateBusiness({ ...green, invoicePrefix: "GG INV/" }).join(" "),
    /Invoice prefix/,
  );
  assert.match(
    validateBusiness({ ...green, paymentDays: 1.5 }).join(" "),
    /whole number of days/,
  );
});
test("long PDF descriptions split at word boundaries without losing text", () => {
  assert.deepEqual(splitDescription("Short description"), [
    "Short description",
  ]);
  assert.deepEqual(splitDescription(""), [""]);
  const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
  const parts = splitDescription(words, 120);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.length <= 120));
  assert.ok(parts.every((part) => /^word\d+( word\d+)*$/.test(part)));
  assert.equal(parts.join(" "), words);
  // Prefer a paragraph break when it is past the halfway point of a chunk.
  const first = "Phase one covers site measurement and the agreed scope.";
  const paragraphs = `${first}\n${"x ".repeat(80)}`;
  assert.equal(splitDescription(paragraphs, 100)[0], first);
  const unbroken = "y".repeat(250);
  assert.equal(splitDescription(unbroken, 100).join(""), unbroken);
});
test("Supabase rows round-trip every record, and conversions stay linked both ways", () => {
  const db = createFixtures();
  const quote = db.documents.find(
    (d) => d.kind === "quotation" && d.status === "issued",
  )!;
  const { db: converted, invoiceId } = convertQuotation(db, quote.id);
  const back = rowsToDatabase({
    businesses: converted.businesses.map(businessToRow),
    customers: converted.customers.map(customerToRow),
    items: converted.items.map(itemToRow),
    // The database stores the link on the invoice only.
    documents: converted.documents.map((d) =>
      documentToRow({ ...d, linkedInvoiceId: undefined }),
    ),
  });
  assert.deepEqual(back.businesses, converted.businesses);
  assert.deepEqual(back.customers, converted.customers);
  assert.deepEqual(back.items, converted.items);
  const byId = new Map(back.documents.map((d) => [d.id, d]));
  for (const doc of converted.documents)
    assert.deepEqual(
      JSON.parse(JSON.stringify(byId.get(doc.id))),
      JSON.parse(JSON.stringify(doc)),
    );
  assert.equal(byId.get(quote.id)!.linkedInvoiceId, invoiceId);
  assert.equal(byId.get(invoiceId)!.sourceQuotationNumber, quote.number);
  // Newest first, and valid by the same rules as browser storage.
  assert.ok(
    back.documents.every(
      (d, i, all) => i === 0 || all[i - 1].updatedAt >= d.updatedAt,
    ),
  );
  assert.doesNotThrow(() => parseDatabase(JSON.stringify(back)));
  assert.deepEqual(linkConversions(back.documents), back.documents);
});
test("saved records merge into what is on screen without touching other records", () => {
  const db = createFixtures();
  const quote = db.documents.find(
    (d) => d.kind === "quotation" && d.status === "issued",
  )!;
  const { db: converted, invoiceId } = convertQuotation(db, quote.id);
  const invoice = converted.documents.find((d) => d.id === invoiceId)!;
  const merged = merge(db, "documents", invoice);
  assert.equal(merged.documents[0].id, invoiceId, "new documents come first");
  assert.equal(
    merged.documents.find((d) => d.id === quote.id)!.linkedInvoiceId,
    invoiceId,
  );
  assert.equal(db.documents.length + 1, merged.documents.length);
  assert.equal(merged.businesses, db.businesses);
  const renamed = { ...db.customers[0], name: "Renamed customer" };
  const withCustomer = merge(db, "customers", renamed);
  assert.equal(withCustomer.customers[0].name, "Renamed customer");
  assert.equal(withCustomer.customers.length, db.customers.length);
  assert.equal(db.customers[0].name, "Mahlangu Property Group");
});
test("database and sign-in failures become messages an employee can act on", () => {
  assert.equal(
    databaseMessage({
      code: "P0001",
      message: "Issued documents are read-only.",
    }),
    "Issued documents are read-only.",
  );
  assert.match(databaseMessage({ code: "42501" }), /administrator/);
  assert.match(databaseMessage({ code: "23505" }), /another employee/);
  assert.equal(
    databaseMessage({ message: "TypeError: Failed to fetch" }),
    OFFLINE,
  );
  assert.match(
    databaseMessage({ code: "XX000", message: "boom" }),
    /could not complete.*boom/,
  );
  assert.equal(
    signInMessage({ code: "invalid_credentials", status: 400 }),
    "Email or password is incorrect.",
  );
  assert.match(signInMessage({ status: 429 }), /Too many/);
  assert.match(
    signInMessage({ name: "AuthRetryableFetchError", status: 0 }),
    /internet connection/,
  );
});

test("a logo the app allows but storage refuses says the storage limit needs raising", () => {
  const tooLarge = { statusCode: "413", message: "Payload too large" };
  assert.match(
    storageMessage(tooLarge, 732_800),
    /storage limit hasn’t been raised/,
  );
  assert.match(storageMessage(tooLarge, 4 * 1024 * 1024), /smaller than 3 MB/);
  assert.match(storageMessage(tooLarge), /smaller than 3 MB/);
});

test("the hidden due / expiry date follows the document date and never blocks a save", () => {
  const business = { paymentDays: 30, validityDays: 14 };
  assert.equal(endDateFor("2026-11-08", business, "invoice"), "2026-12-08");
  assert.equal(endDateFor("2026-12-25", business, "quotation"), "2027-01-08");
  assert.equal(endDateFor("", business, "invoice"), "");
  const doc = clone(createFixtures().documents[0]);
  doc.date = "2027-03-01";
  doc.endDate = endDateFor(doc.date, business, doc.kind);
  assert.ok(!validateDocument(doc).some((e) => /date/i.test(e)));
});

test("drafts never reserve numbers, including legacy drafts; issuing uses the current next number", () => {
  let db = createFixtures();
  const business = db.businesses[0];
  const draft = blankDocument(business, "invoice", db.customers[0]);
  draft.lines = [item(100)];
  const number = nextNumber(db.documents, business, "invoice");
  db = saveDocument(db, { ...draft, number: "9999" });
  assert.equal(db.documents.find((d) => d.id === draft.id)!.number, "");
  assert.equal(nextNumber(db.documents, business, "invoice"), number);
  const other = { ...draft, id: crypto.randomUUID() };
  db = saveDocument(db, other, true);
  assert.equal(db.documents.find((d) => d.id === other.id)!.number, number);
  db = saveDocument(db, draft, true);
  assert.equal(
    db.documents.find((d) => d.id === draft.id)!.number,
    "GZ-INV-0005",
  );
  const legacy = { ...draft, id: crypto.randomUUID(), number: "9999" };
  db.documents.push(legacy);
  assert.equal(
    parseDatabase(JSON.stringify(db)).documents.find((d) => d.id === legacy.id)!
      .number,
    "",
  );
  assert.equal(
    nextNumber(db.documents, { ...business, invoicePrefix: "" }, "invoice"),
    "0006",
  );
});

test("fixed discounts reduce the subtotal before VAT with cent rounding", () => {
  assert.deepEqual(calculate([item(15000)], 15, 1000), {
    subtotal: 15000,
    tax: 2100,
    total: 16100,
  });
  assert.deepEqual(calculate([item(333.333333, 3)], 15, 100), {
    subtotal: 1000,
    tax: 135,
    total: 1035,
  });
  assert.deepEqual(calculate([item(100)], 0, 10), {
    subtotal: 100,
    tax: 0,
    total: 90,
  });
  assert.deepEqual(calculate([item(100)], 15, 100), {
    subtotal: 100,
    tax: 0,
    total: 0,
  });
  assert.deepEqual(calculate([item(0.335), item(0.335)], 15, 0.01), {
    subtotal: 0.68,
    tax: 0.1,
    total: 0.77,
  });
});

test("discounts persist through drafts, issued edits, row mapping and quotation conversion", () => {
  let db = createFixtures();
  const quote = blankDocument(db.businesses[0], "quotation", db.customers[0]);
  quote.lines = [item(100)];
  quote.discountAmount = 10;
  db = saveDocument(db, quote);
  let saved = db.documents.find((d) => d.id === quote.id)!;
  assert.equal(
    parseDatabase(JSON.stringify(db)).documents.find((d) => d.id === quote.id)!
      .discountAmount,
    10,
  );
  db = saveDocument(db, saved, true);
  saved = db.documents.find((d) => d.id === quote.id)!;
  const converted = convertQuotation(db, quote.id);
  const invoice = converted.db.documents.find(
    (d) => d.id === converted.invoiceId,
  )!;
  assert.equal(invoice.discountAmount, 10);
  assert.deepEqual(invoice.totals, { subtotal: 100, tax: 13.5, total: 103.5 });
  assert.equal(documentToRow(invoice).discount_amount, 10);
  const roundTrip = rowsToDatabase({
    businesses: db.businesses.map(businessToRow),
    customers: db.customers.map(customerToRow),
    items: db.items.map(itemToRow),
    documents: converted.db.documents.map(documentToRow),
  });
  assert.equal(
    roundTrip.documents.find((d) => d.id === invoice.id)!.discountAmount,
    10,
  );
  const revision = reviseDocument(saved);
  const edited = saveDocument(
    converted.db,
    { ...revision, discountAmount: 20 },
    true,
  );
  assert.deepEqual(edited.documents.find((d) => d.id === revision.id)!.totals, {
    subtotal: 100,
    tax: 12,
    total: 92,
  });
  assert.equal(
    edited.documents.find((d) => d.id === invoice.id)!.discountAmount,
    10,
  );
});

test("invalid discounts are rejected and old records default to zero without changing totals", () => {
  const db = createFixtures();
  const draft = blankDocument(db.businesses[0], "invoice", db.customers[0]);
  draft.lines = [item(100)];
  for (const discountAmount of [-1, 100.01, NaN, Infinity, 0.001]) {
    assert.throws(
      () => saveDocument(db, { ...draft, discountAmount }),
      /Discount amount/,
    );
  }
  const legacy = JSON.parse(JSON.stringify(db));
  for (const doc of legacy.documents) delete doc.discountAmount;
  const loaded = parseDatabase(JSON.stringify(legacy));
  assert.ok(loaded.documents.every((d) => d.discountAmount === 0));
  assert.deepEqual(
    loaded.documents.map((d) => d.totals),
    db.documents.map((d) => d.totals),
  );
});
