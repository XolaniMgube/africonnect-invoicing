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
  ArrowRight,
  Package,
  CheckCircle2,
  Link2,
  UserPlus,
} from "lucide-react";
import { useData } from "@/components/provider";
import {
  Badge,
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
  money,
  validateDocument,
} from "@/domain/documents";
import type {
  Business,
  BusinessDocument,
  Customer,
  LineItem,
} from "@/domain/types";
import { units } from "@/domain/types";
import { DocumentPreview } from "./document-preview";
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
        description="Return to the overview and choose an existing document."
      >
        <Link href="/overview" className="btn primary">
          Back to overview
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
  const [customerQuery, setCustomerQuery] = useState("");
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
  const locked = issued || business.archived;
  const dirty = !issued && JSON.stringify(doc) !== baseline;
  useUnsavedChanges(dirty);
  if (!db) return null;
  const customers = db.customers.filter((c) => c.businessId === business.id);
  const items = db.items.filter(
    (i) =>
      i.businessId === business.id &&
      !i.archived &&
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
  const liveDoc =
    issued || doc.sourceQuotationId
      ? doc
      : {
          ...doc,
          snapshot: {
            issuer: business,
            customer:
              customers.find((c) => c.id === doc.customerId) ||
              doc.snapshot.customer,
          },
        };
  const totals = calculate(doc.lines, doc.taxRate);
  async function save(issue = false) {
    if (saving) return;
    const validation = validateDocument(liveDoc);
    if (validation.length) {
      setErrors(validation);
      setIssuing(false);
      return;
    }
    setSaving(true);
    const before = JSON.stringify(doc);
    const saved = await saveDocument(
      liveDoc,
      issue,
      issue
        ? `${kind === "invoice" ? "Invoice" : "Quotation"} issued. The document is now read-only.`
        : "Draft saved.",
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
        title={doc.number || `New ${kind}`}
        description={
          issued
            ? `Issued by ${doc.snapshot.issuer.name}. Preserved exactly as issued.`
            : "Build a clear, professional document. Review it before issuing."
        }
      >
        <Badge status={doc.status} />
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
      {issued ? (
        <>
          <div className="issued-banner">
            <LockKeyhole size={20} />
            <div>
              <strong>Issued and preserved</strong>
              <p>
                This document is read-only. Changes to business details,
                customers or prices will not affect it.
              </p>
            </div>
            {kind === "quotation" &&
              (db.documents.find((d) => d.id === doc.id)?.linkedInvoiceId ? (
                <Link
                  className="btn primary"
                  href={`/documents/${db.documents.find((d) => d.id === doc.id)!.linkedInvoiceId}`}
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
                      <SearchBox
                        value={customerQuery}
                        onChange={setCustomerQuery}
                        placeholder="Find a customer…"
                      />
                      <Field label="Customer">
                        <select
                          value={doc.customerId}
                          onChange={(e) => {
                            const c = customers.find(
                              (c) => c.id === e.target.value,
                            );
                            set({
                              customerId: e.target.value,
                              snapshot: {
                                ...doc.snapshot,
                                customer: c ? clone(c) : doc.snapshot.customer,
                              },
                            });
                          }}
                        >
                          <option value="">Select a customer</option>
                          {customers
                            .filter(
                              (c) =>
                                c.id === doc.customerId ||
                                `${c.name} ${c.email}`
                                  .toLowerCase()
                                  .includes(customerQuery.toLowerCase()),
                            )
                            .map((c) => (
                              <option value={c.id} key={c.id}>
                                {c.name}
                              </option>
                            ))}
                        </select>
                      </Field>
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
                        onChange={(e) => set({ date: e.target.value })}
                      />
                    </Field>
                    <Field
                      label={
                        kind === "invoice" ? "Payment due date" : "Valid until"
                      }
                    >
                      <input
                        type="date"
                        required
                        min={doc.date}
                        value={doc.endDate}
                        onChange={(e) => set({ endDate: e.target.value })}
                      />
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
                      <div className="line-numbers">
                        <Field label="Quantity">
                          <input
                            type="number"
                            min="0.001"
                            max="10000000"
                            step="any"
                            value={Number.isNaN(l.quantity) ? "" : l.quantity}
                            onChange={(e) =>
                              line(l.id, {
                                quantity:
                                  e.target.value === ""
                                    ? NaN
                                    : Number(e.target.value),
                              })
                            }
                          />
                        </Field>
                        <Field label="Unit">
                          <select
                            value={l.unit}
                            onChange={(e) =>
                              line(l.id, { unit: e.target.value })
                            }
                          >
                            {units.map((u) => (
                              <option key={u}>{u}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Unit price (R)">
                          <input
                            type="number"
                            min="0"
                            max="1000000000"
                            step="0.01"
                            value={Number.isNaN(l.price) ? "" : l.price}
                            onChange={(e) =>
                              line(l.id, {
                                price:
                                  e.target.value === ""
                                    ? NaN
                                    : Number(e.target.value),
                              })
                            }
                          />
                        </Field>
                        <div className="line-total">
                          <span>Line total</span>
                          <strong>{money(calculate([l], 0).total)}</strong>
                        </div>
                      </div>
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
                <small>
                  {dirty
                    ? "Unsaved changes"
                    : initial
                      ? "All changes saved"
                      : "Not saved yet"}
                  <br />
                  Issuing makes this document read-only.
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
        description="This saves a permanent snapshot of the business, customer, line items and totals. You will no longer be able to edit this document."
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
                      description: item.description,
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
