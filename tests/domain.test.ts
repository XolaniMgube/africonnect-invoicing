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
  rowsToDatabase,
} from "../src/data/rows";
import { DESIGN_DEFAULTS, templateOf } from "../src/domain/templates";
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
