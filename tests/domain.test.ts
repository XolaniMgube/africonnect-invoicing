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
  saveDocument,
  scoped,
  validateDocument,
} from "../src/domain/documents";
import {
  loadDatabase,
  parseDatabase,
  persistDatabase,
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
  rowsToDatabase,
} from "../src/data/rows";
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
    db = saveDocument(db, invoice);
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
    db = saveDocument(db, quote);
    assert.ok(
      db.documents.find((d) => d.id === quote.id)?.number.endsWith("-0003"),
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
    /cannot go back to being a draft/,
  );
});
test("issued invoices and quotations can be edited in place, but not returned to draft", () => {
  let db = createFixtures();
  for (const kind of ["invoice", "quotation"] as const) {
    const doc = clone(
      db.documents.find((d) => d.kind === kind && d.status === "issued")!,
    );
    doc.lines = [{ ...doc.lines[0], quantity: 2, price: 50 }];
    db = saveDocument(db, doc, true);
    const edited = db.documents.find((d) => d.id === doc.id)!;
    assert.equal(edited.number, doc.number);
    assert.equal(edited.status, "issued");
    assert.equal(edited.totals.subtotal, 100);
    assert.equal(
      db.documents.filter(
        (d) => d.businessId === doc.businessId && d.number === doc.number,
      ).length,
      1,
    );
    assert.throws(
      () => saveDocument(db, { ...edited, notes: "changed" }),
      /cannot go back to being a draft/,
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
  assert.ok(
    validateDocument(noVat).some((e) => e.includes("VAT registration")),
  );
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
test("business profiles need VAT numbers before charging VAT and distinct, valid prefixes", () => {
  const db = createFixtures();
  const green = db.businesses.find((b) => b.id === "green")!;
  assert.deepEqual(validateBusiness(green), []);
  assert.match(
    validateBusiness({ ...green, taxRate: 15 }).join(" "),
    /VAT registration number/,
  );
  assert.throws(
    () => upsertBusiness(db, { ...green, taxRate: 15 }),
    /VAT registration number/,
  );
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

test("document numbers: chosen numbers are kept, later ones continue from them, prefixes may be empty", () => {
  let db = createFixtures();
  const green = db.businesses.find((b) => b.id === "green")!;
  assert.equal(nextNumber(db.documents, green, "invoice"), "GG-INV-0004");
  // A chosen number is kept, and the next suggestion continues from it.
  const draft = blankDocument(green, "invoice", db.customers[2]);
  draft.lines = [{ ...db.documents[0].lines[0] }];
  db = saveDocument(db, { ...draft, number: " 0123 " });
  assert.equal(db.documents.find((d) => d.id === draft.id)!.number, "0123");
  assert.equal(nextNumber(db.documents, green, "invoice"), "GG-INV-0124");
  // The same number cannot be used twice by one business for one type.
  const copy = { ...draft, id: crypto.randomUUID(), number: "0123" };
  assert.throws(() => saveDocument(db, copy), /already used/);
  // An empty number keeps an existing document's number.
  db = saveDocument(db, { ...draft, number: "", notes: "Edited" });
  assert.equal(db.documents.find((d) => d.id === draft.id)!.number, "0123");
  // Without a prefix the number is just the digits; padding follows the
  // highest number, and grows when it has to.
  const plain = { ...green, invoicePrefix: "", quotationPrefix: "" };
  assert.deepEqual(validateBusiness(plain), []);
  assert.equal(nextNumber(db.documents, plain, "invoice"), "0124");
  assert.equal(nextNumber([], plain, "quotation"), "0001");
  const nines = [{ ...db.documents[0], businessId: "x", number: "999" }];
  assert.equal(nextNumber(nines, { ...plain, id: "x" }, "invoice"), "1000");
  assert.match(
    validateBusiness({
      ...green,
      invoicePrefix: "INV",
      quotationPrefix: "inv",
    }).join(" "),
    /different invoice and quotation prefixes/,
  );
});
