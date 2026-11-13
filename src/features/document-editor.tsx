"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  Eye,
  Send,
  Download,
  LockKeyhole,
  PencilLine,
  ArrowRight,
  Package,
  CheckCircle2,
  Link2,
  UserPlus,
} from "lucide-react";
import { useData } from "@/components/provider";
import {
  Button,
  Empty,
  Field,
  Modal,
  PageHeading,
  SearchBox,
} from "@/components/ui";
import {
  hasVisibleUnsavedChanges,
  useUnsavedChanges,
} from "@/components/unsaved";
import {
  blankDocument,
  calculate,
  clone,
  endDateFor,
  money,
  nextNumber,
  reviseDocument,
  validateDocument,
} from "@/domain/documents";
import type {
  Business,
  BusinessDocument,
  Customer,
  LineItem,
} from "@/domain/types";
import { CustomerPicker } from "./customer-picker";
import { DocumentPreview } from "./document-preview";
import { PaymentsPanel, StatusBadge } from "./payments";
import { EmailPanel } from "./email";
import { revisionBlocked } from "@/domain/receivables";
import { LineAmounts } from "./line-amounts";
import { RecordForm, blankCustomer } from "./records";
export function NewDocument() {
  const { businessId } = useParams<{ businessId: string }>();
  const params = useSearchParams();
  // A fresh navigation to "new document" starts a blank editor; browser
  // back/forward still restores an in-progress draft.
  const { bfcacheId } = useRouter();
  const { db } = useData();
  const b = db?.businesses.find((b) => b.id === businessId);
  if (!b || b.archived)
    return (
      <Empty
        title="Business unavailable"
        description={
          b
            ? `${b.name} is archived. Restore it from Client businesses before creating documents.`
            : "Choose an active client business before creating a document."
        }
      >
        <Link href="/businesses" className="btn primary">
          Client businesses
        </Link>
      </Empty>
    );
  return (
    <Editor
      key={`${b.id}-${params.get("kind")}-${bfcacheId}`}
      business={b}
      kind={params.get("kind") === "quotation" ? "quotation" : "invoice"}
    />
  );
}
export function DocumentDetail() {
  const { documentId } = useParams<{ documentId: string }>();
  const { db } = useData();
  const doc = db?.documents.find((d) => d.id === documentId);
  const b = db?.businesses.find((b) => b.id === doc?.businessId);
  if (!doc || !b)
    return (
      <Empty
        title="Document not found"
        description="Open the client business and choose an existing document."
      >
        <Link href="/businesses" className="btn primary">
          Client businesses
        </Link>
      </Empty>
    );
  return <Editor key={doc.id} business={b} initial={doc} kind={doc.kind} />;
}
function Editor({
  business,
  initial,
  kind,
}: {
  business: Business;
  initial?: BusinessDocument;
  kind: BusinessDocument["kind"];
}) {
  const { db, saveDocument, convertQuotation, notify } = useData();
  const router = useRouter();
  const [doc, setDoc] = useState<BusinessDocument>(() =>
    initial ? clone(initial) : blankDocument(business, kind),
  );
  const [baseline, setBaseline] = useState(() => JSON.stringify(doc));
  const [preview, setPreview] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [catalogue, setCatalogue] = useState(false);
  const [query, setQuery] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [newCustomer, setNewCustomer] = useState<Customer | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errors.length) errorRef.current?.focus();
  }, [errors]);
  const issued = doc.status === "issued";
  const readOnly = issued;
  const locked = readOnly || business.archived;
  const dirty = !readOnly && JSON.stringify(doc) !== baseline;
  useUnsavedChanges(dirty);
  if (!db) return null;
  const customers = db.customers.filter((c) => c.businessId === business.id);
  const items = db.items.filter(
    (i) =>
      i.businessId === business.id &&
      `${i.name} ${i.description} ${i.category}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const set = (partial: Partial<BusinessDocument>) =>
    setDoc((d) => ({ ...d, ...partial }));
  const line = (id: string, partial: Partial<LineItem>) =>
    setDoc((d) => ({
      ...d,
      lines: d.lines.map((l) => (l.id === id ? { ...l, ...partial } : l)),
    }));
  const suggested = nextNumber(db.documents, business, kind);
  const liveDoc = {
    ...(readOnly || doc.sourceQuotationId || doc.revisionOfId
      ? doc
      : {
          ...doc,
          snapshot: {
            issuer: business,
            customer:
              customers.find((c) => c.id === doc.customerId) ||
              doc.snapshot.customer,
          },
        }),
    number: readOnly ? doc.number : "",
  };
  const totals = calculate(doc.lines, doc.taxRate, doc.discountAmount);
  const title = kind === "invoice" ? "Invoice" : "Quotation";
  const linkedInvoiceId = db.documents.find(
    (d) => d.id === doc.id,
  )?.linkedInvoiceId;
  async function save(issue = false) {
    if (saving) return;
    const toSave = { ...liveDoc, number: "" };
    const validation = validateDocument(toSave);

    if (validation.length) {
      setErrors(validation);
      setIssuing(false);
      return;
    }
    setSaving(true);
    const before = JSON.stringify(doc);
    const saved = await saveDocument(
      toSave,
      issue,
      issue ? `${title} issued.` : "Draft saved.",
    );
    if (saved) {
      // Keep anything typed while the save was in flight.
      setDoc((d) =>
        issue || JSON.stringify(d) === before
          ? saved
          : { ...d, number: saved.number, updatedAt: saved.updatedAt },
      );
      setBaseline(JSON.stringify(saved));
      setErrors([]);
      setIssuing(false);

      if (!initial) router.replace(`/documents/${saved.id}`);
    }
    setSaving(false);
  }
  async function revise() {
    if (saving) return;
    const blocked = revisionBlocked(db!, doc);
    if (blocked) {
      notify(blocked, true);
      return;
    }
    const draft = db!.documents.find(
      (d) => d.revisionOfId === doc.id && d.status === "draft",
    );
    if (draft) {
      router.push(`/documents/${draft.id}`);
      return;
    }
    setSaving(true);
    const saved = await saveDocument(
      reviseDocument(doc),
      false,
      "Draft revision created. The issued original is unchanged.",
    );
    if (saved) router.push(`/documents/${saved.id}`);
    setSaving(false);
  }
  async function exportPdf() {
    setPdfBusy(true);
    try {
      const { downloadPDF } = await import("@/pdf/document-pdf");
      await downloadPDF(liveDoc);
      notify("PDF download prepared.");
    } catch {
      notify(
        "The PDF could not be generated. Check the business logo and try again.",
        true,
      );
    } finally {
      setPdfBusy(false);
    }
  }
  async function convert() {
    if (converting) return;
    setConverting(true);
    const invoice = await convertQuotation(
      doc.id,
      "Linked invoice draft ready for review. Check the details before issuing.",
    );
    if (invoice) router.push(`/documents/${invoice.id}`);
    else setConverting(false);
  }
  return (
    <div data-unsaved={dirty}>
      <Link className="back-link" href={`/businesses/${business.id}`}>
        <ArrowLeft size={16} />
        Business documents
      </Link>
      <PageHeading
        eyebrow={kind.toUpperCase()}
        title={doc.number || `Draft ${kind}`}
        description={
          issued
            ? `Issued by ${doc.snapshot.issuer.name}. Preserved exactly as issued.`
            : "Draft only. An official number is assigned when you issue it."
        }
      >
        <StatusBadge db={db} doc={doc} />
        <Button variant="secondary" onClick={() => setPreview(true)}>
          <Eye size={17} />
          Preview
        </Button>
        <Button
          variant="secondary"
          disabled={pdfBusy}
          onClick={() => void exportPdf()}
        >
          <Download size={17} />
          {pdfBusy ? "Preparing PDF…" : "Download PDF"}
        </Button>
      </PageHeading>
      {doc.revisionOfId && (
        <div className="info-note">
          Revision of{" "}
          <Link href={`/documents/${doc.revisionOfId}`}>
            {db.documents.find((d) => d.id === doc.revisionOfId)?.number ||
              "original document"}
          </Link>
          . The original remains unchanged.
        </div>
      )}
      {db.documents
        .filter((d) => d.revisionOfId === doc.id)
        .map((revision) => (
          <div className="info-note" key={revision.id}>
            <Link href={`/documents/${revision.id}`}>
              {revision.number || "Open draft revision"}
            </Link>
            <StatusBadge db={db} doc={revision} />
          </div>
        ))}
      {doc.sourceQuotationId && (
        <div className="info-note">
          <Link2 size={19} />
          <span>
            Created from quotation{" "}
            <Link href={`/documents/${doc.sourceQuotationId}`}>
              {doc.sourceQuotationNumber}
            </Link>
            .{" "}
            {issued
              ? "The quotation remains unchanged."
              : "The quoted business details, customer, items and prices were copied. Review them before issuing."}
          </span>
        </div>
      )}
      {readOnly ? (
        <>
          <div className="issued-banner">
            <LockKeyhole size={20} />
            <div>
              <strong>Issued and preserved</strong>
              <p>
                Changes to business details, customers or prices elsewhere will
                not affect it. Editing creates a separate draft revision.
                Issuing that revision assigns the next available number.
              </p>
            </div>
            {!business.archived && (
              <Button
                variant="secondary"
                disabled={saving}
                onClick={() => void revise()}
              >
                <PencilLine size={16} />
                Edit {kind}
              </Button>
            )}
            {kind === "quotation" &&
              (linkedInvoiceId ? (
                <Link
                  className="btn primary"
                  href={`/documents/${linkedInvoiceId}`}
                >
                  Open linked invoice
                  <ArrowRight size={16} />
                </Link>
              ) : (
                !business.archived && (
                  <Button onClick={convert} disabled={converting}>
                    {converting ? "Creating invoice…" : "Convert to invoice"}
                    <ArrowRight size={16} />
                  </Button>
                )
              ))}
          </div>
          <PaymentsPanel doc={doc} />
          <EmailPanel doc={doc} />
          <DocumentPreview doc={doc} />
        </>
      ) : (
        <>
          {business.archived && (
            <div className="info-note">
              Restore this business to edit or issue this draft.
            </div>
          )}
          {errors.length > 0 && (
            <div
              className="form-error"
              role="alert"
              tabIndex={-1}
              ref={errorRef}
            >
              <strong>Please check these details</strong>
              <ul>
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="editor-grid">
            <div className="editor-main">
              <section className="card editor-section">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">01 · THE DETAILS</span>
                    <h2>Customer & dates</h2>
                  </div>
                </div>
                <fieldset disabled={locked}>
                  <div className="form-grid">
                    <div>
                      <CustomerPicker
                        customers={customers}
                        value={doc.customerId}
                        onChange={(customerId) => {
                          const c = customers.find((c) => c.id === customerId);
                          set({
                            customerId,
                            snapshot: {
                              ...doc.snapshot,
                              customer: c ? clone(c) : doc.snapshot.customer,
                            },
                          });
                        }}
                      />
                      {!customers.length && (
                        <p className="field-note">
                          {business.name} has no customers yet. Add the
                          recipient of this document to continue.
                        </p>
                      )}
                      <button
                        type="button"
                        className="text-link"
                        onClick={() =>
                          setNewCustomer(blankCustomer(business.id))
                        }
                      >
                        <UserPlus size={14} />
                        Add a new customer
                      </button>
                    </div>
                    <div className="customer-summary">
                      {doc.customerId ? (
                        <>
                          <strong>{liveDoc.snapshot.customer.name}</strong>
                          <p className="preserve-lines">
                            {liveDoc.snapshot.customer.address}
                          </p>
                          <small>{liveDoc.snapshot.customer.email}</small>
                        </>
                      ) : (
                        <p>Select a customer to see their billing details.</p>
                      )}
                    </div>
                    <Field
                      label={
                        kind === "invoice" ? "Invoice date" : "Quotation date"
                      }
                    >
                      <input
                        type="date"
                        required
                        value={doc.date}
                        onChange={(e) =>
                          set({
                            date: e.target.value,
                            endDate: endDateFor(e.target.value, business, kind),
                          })
                        }
                      />
                    </Field>
                    {kind === "invoice" && business.isSuper && (
                      <Field
                        label="Due date"
                        hint="Used for Overdue and reminders. Not printed on the invoice."
                      >
                        <input
                          type="date"
                          required
                          min={doc.date}
                          value={doc.endDate}
                          onChange={(e) => set({ endDate: e.target.value })}
                        />
                      </Field>
                    )}
                    <Field
                      label={
                        kind === "invoice"
                          ? "Invoice number"
                          : "Quotation number"
                      }
                      hint="Assigned on issue. Drafts do not reserve numbers; this estimate may change if another document is issued first."
                    >
                      <input value={suggested} readOnly />
                    </Field>
                  </div>
                  <Field
                    label={
                      kind === "invoice" ? "Payment terms" : "Quotation terms"
                    }
                  >
                    <input
                      value={doc.terms}
                      maxLength={1000}
                      onChange={(e) => set({ terms: e.target.value })}
                    />
                  </Field>
                </fieldset>
              </section>
              <section className="card editor-section">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">02 · THE WORK</span>
                    <h2>Items & services</h2>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={locked}
                    onClick={() => setCatalogue(true)}
                  >
                    <Package size={16} />
                    From catalogue
                  </Button>
                </div>
                <fieldset disabled={locked}>
                  {!doc.lines.length && (
                    <div className="line-empty">
                      Add a service from the catalogue or create a custom line
                      below.
                    </div>
                  )}
                  {doc.lines.map((l, index) => (
                    <div className="line-editor" key={l.id}>
                      <div className="line-heading">
                        <span className="line-index">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <Field label="Item / service name">
                          <input
                            aria-label={`Line ${index + 1} name`}
                            value={l.name}
                            maxLength={160}
                            onChange={(e) =>
                              line(l.id, { name: e.target.value })
                            }
                          />
                        </Field>
                        <button
                          className="icon-btn danger-text"
                          aria-label={`Remove line ${index + 1}`}
                          onClick={() =>
                            set({
                              lines: doc.lines.filter((i) => i.id !== l.id),
                            })
                          }
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                      {/* Descriptions are no longer added; a line that
                          already has one (older drafts and conversions) keeps
                          it editable so it is never printed unseen. */}
                      {l.description && (
                        <Field label="Description">
                          <textarea
                            rows={2}
                            maxLength={10000}
                            value={l.description}
                            onChange={(e) =>
                              line(l.id, { description: e.target.value })
                            }
                          />
                        </Field>
                      )}
                      <LineAmounts
                        line={l}
                        onChange={(partial) => line(l.id, partial)}
                      />
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    onClick={() =>
                      set({
                        lines: [
                          ...doc.lines,
                          {
                            id: crypto.randomUUID(),
                            name: "",
                            description: "",
                            quantity: 1,
                            unit: "Item",
                            price: 0,
                          },
                        ],
                      })
                    }
                  >
                    <Plus size={17} />
                    Add custom line
                  </Button>
                  <label className="checkbox-label show-prices">
                    <input
                      type="checkbox"
                      checked={doc.showItemPrices !== false}
                      onChange={(e) =>
                        set({ showItemPrices: e.target.checked })
                      }
                    />
                    Show item prices on the document
                  </label>
                  <small className="show-prices-hint">
                    Turn off to print only Description, Qty and Total for each
                    line. Totals are unchanged.
                  </small>
                </fieldset>
              </section>
              <section className="card editor-section">
                <span className="eyebrow">03 · THE FINISHING TOUCHES</span>
                <h2>Notes & instructions</h2>
                <Field label="Document notes">
                  <textarea
                    disabled={locked}
                    rows={4}
                    maxLength={10000}
                    value={doc.notes}
                    onChange={(e) => set({ notes: e.target.value })}
                  />
                </Field>
              </section>
            </div>
            <aside className="editor-summary">
              <section className="card summary-card">
                <h2>Document summary</h2>
                <p>
                  {kind === "invoice" ? "Invoice" : "Quotation"} · South African
                  rand
                </p>
                <div className="summary-row">
                  <span>Subtotal</span>
                  <strong>{money(totals.subtotal)}</strong>
                </div>
                <Field
                  label="Discount amount (R)"
                  hint="Deducted from the subtotal before VAT. Use 0 for no discount."
                >
                  <input
                    type="number"
                    disabled={locked}
                    min="0"
                    max={totals.subtotal}
                    step="0.01"
                    value={
                      Number.isNaN(doc.discountAmount)
                        ? ""
                        : (doc.discountAmount ?? 0)
                    }
                    onChange={(e) =>
                      set({
                        discountAmount:
                          e.target.value === "" ? 0 : Number(e.target.value),
                      })
                    }
                  />
                </Field>
                {(doc.discountAmount ?? 0) > 0 && (
                  <div className="summary-row">
                    <span>After discount</span>
                    <strong>
                      {money(totals.subtotal - doc.discountAmount)}
                    </strong>
                  </div>
                )}
                <Field
                  label="VAT rate (%)"
                  hint="Use 0 if this business does not charge VAT."
                >
                  <input
                    disabled={locked}
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={Number.isNaN(doc.taxRate) ? "" : doc.taxRate}
                    onChange={(e) =>
                      set({
                        taxRate:
                          e.target.value === "" ? NaN : Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <div className="summary-row">
                  <span>VAT ({doc.taxRate || 0}%)</span>
                  <strong>{money(totals.tax)}</strong>
                </div>
                <div className="summary-total">
                  <span>
                    {kind === "invoice" ? "Total due" : "Quoted total"}
                  </span>
                  <strong>{money(totals.total)}</strong>
                </div>
                <>
                  <Button
                    variant="secondary"
                    disabled={locked || saving}
                    onClick={() => save()}
                  >
                    <Save size={17} />
                    Save draft
                  </Button>
                  <Button
                    disabled={locked || saving}
                    onClick={() => {
                      const e = validateDocument(liveDoc);
                      setErrors(e);
                      if (!e.length) setIssuing(true);
                    }}
                  >
                    <Send size={17} />
                    Issue {kind}
                  </Button>
                </>
                <small>
                  {dirty
                    ? "Unsaved changes"
                    : initial
                      ? "All changes saved"
                      : "Not saved yet"}
                  <br />
                  Editing an issued document creates a new draft revision.
                </small>
              </section>
              <div className="editor-tip">
                <CheckCircle2 size={18} />
                <p>
                  Prices entered here only affect this document. Your catalogue
                  stays unchanged.
                </p>
              </div>
            </aside>
          </div>
        </>
      )}
      <Modal
        open={preview}
        onOpenChange={setPreview}
        title={`${kind === "invoice" ? "Invoice" : "Quotation"} preview`}
        description="The PDF uses this same document data and calculation policy."
        wide
      >
        <DocumentPreview doc={liveDoc} />
        <div className="dialog-actions">
          <Button disabled={pdfBusy} onClick={() => void exportPdf()}>
            <Download size={16} />
            {pdfBusy ? "Preparing PDF…" : "Download PDF"}
          </Button>
        </div>
      </Modal>
      <Modal
        open={issuing}
        onOpenChange={setIssuing}
        title={`Issue this ${kind}?`}
        description={`This assigns the next available number and preserves the ${kind}. Later edits create a separate draft revision; the issued original stays unchanged.`}
      >
        <div className="issue-review">
          <span>{liveDoc.snapshot.customer.name}</span>
          <strong>{money(totals.total)}</strong>
        </div>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setIssuing(false)}>
            Keep editing
          </Button>
          <Button disabled={saving} onClick={() => save(true)}>
            Confirm & issue
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!newCustomer}
        onOpenChange={(v) => {
          if (
            !v &&
            hasVisibleUnsavedChanges() &&
            !window.confirm("Discard this new customer?")
          )
            return;
          if (!v) setNewCustomer(null);
        }}
        title="Add a customer"
        description={`Saved to ${business.name}'s customers and selected for this document.`}
        wide
      >
        {newCustomer && (
          <RecordForm
            initial={newCustomer}
            onSaved={(record) => {
              const customer = record as Customer;
              set({
                customerId: customer.id,
                snapshot: { ...doc.snapshot, customer: clone(customer) },
              });
              setNewCustomer(null);
            }}
          />
        )}
      </Modal>
      <Modal
        open={catalogue}
        onOpenChange={setCatalogue}
        title="Add from catalogue"
        description={`Items and services belonging to ${business.name}.`}
      >
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search name, description or category…"
        />
        <div className="selection-list">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                set({
                  lines: [
                    ...doc.lines,
                    {
                      id: crypto.randomUUID(),
                      referenceId: item.id,
                      name: item.name,
                      description: "",
                      unit: item.unit,
                      quantity: 1,
                      price: item.price,
                    },
                  ],
                });
                setCatalogue(false);
              }}
            >
              <span className="record-icon">
                <Package size={19} />
              </span>
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.category} · {item.unit}
                </small>
              </span>
              <b>{money(item.price)}</b>
              <Plus size={17} />
            </button>
          ))}
          {!items.length && (
            <Empty
              title="No matching items"
              description="Try another search, or add a custom line to your document."
            />
          )}
        </div>
      </Modal>
    </div>
  );
}
