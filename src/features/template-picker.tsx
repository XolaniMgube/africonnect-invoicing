"use client";
import { useState } from "react";
import { Eye } from "lucide-react";
import { Button, Field, Modal } from "@/components/ui";
import { blankDocument, calculate } from "@/domain/documents";
import { DOCUMENT_TEMPLATES, templateOf } from "@/domain/templates";
import type { Business, BusinessDocument } from "@/domain/types";
import { DocumentPreview } from "./document-preview";

/** A fictional document in the business's current design, for previewing. */
export function sampleDocument(
  business: Business,
  kind: BusinessDocument["kind"] = "invoice",
): BusinessDocument {
  const doc = blankDocument(business, kind, {
    id: "sample-customer",
    businessId: business.id,
    name: "Sample Customer (Pty) Ltd",
    contact: "",
    email: "accounts@customer.example",
    phone: "+27 00 000 0000",
    address: "1 Example Street\nJohannesburg, 2000",
    registration: "",
    vat: "",
  });
  doc.lines = [
    ["Consultation", "Initial site visit and assessment", 1, 1500],
    ["Materials", "", 4, 320],
    ["Delivery", "", 1, 450],
  ].map(([name, description, quantity, price], i) => ({
    id: `sample-${i}`,
    name: String(name),
    description: String(description),
    unit: "Item",
    quantity: Number(quantity),
    price: Number(price),
  }));
  const prefix = (
    kind === "invoice" ? business.invoicePrefix : business.quotationPrefix
  ).trim();
  doc.number = `${prefix ? `${prefix}-` : ""}0001`;
  doc.status = "issued";
  doc.totals = calculate(doc.lines, doc.taxRate);
  return doc;
}

/** Small drawing of each template's layout, in the business's colours. */
export function Thumbnail({
  id,
  accent,
  secondary,
}: {
  id: Business["template"];
  accent: string;
  secondary: string;
}) {
  return (
    <svg viewBox="0 0 60 80" aria-hidden="true" className="template-thumb">
      <rect width="60" height="80" fill="#fafafa" />
      {id === "executive" ? (
        <>
          <rect x="6" y="6" width="14" height="6" rx="1" fill={accent} />
          <rect x="38" y="6" width="16" height="4" fill={accent} />
          <rect x="6" y="15" width="20" height="1.6" rx="0.8" fill={accent} />
          <rect x="26" y="15.3" width="28" height="1" fill={secondary} />
          <rect x="6" y="27" width="48" height="4" rx="2" fill={accent} />
          {[35, 40, 45].map((y) => (
            <line
              key={y}
              x1="6"
              x2="54"
              y1={y}
              y2={y}
              stroke={secondary}
              strokeWidth="0.5"
              strokeDasharray="1 1"
            />
          ))}
          <rect x="36" y="48" width="18" height="4" rx="2" fill={accent} />
          <rect x="6" y="55" width="22" height="9" rx="1.5" fill={accent} />
          <polygon points="0,76 35,76 39,80 0,80" fill={accent} />
          <polygon points="36.5,76 39,76 43,80 40.5,80" fill={secondary} />
          <polygon points="40.5,76 60,76 60,80 44.5,80" fill={secondary} />
        </>
      ) : (
        <>
          <rect x="6" y="6" width="10" height="7" rx="1" fill={accent} />
          <rect x="6" y="15" width="18" height="2" fill="#9aa39a" />
          <rect x="36" y="6" width="18" height="4" fill={accent} />
          <rect x="6" y="21" width="48" height="0.8" fill={accent} />
          <rect x="6" y="28" width="48" height="4" fill="#e9eee6" />
          {[36, 41, 46].map((y) => (
            <rect key={y} x="6" y={y} width="48" height="0.5" fill="#dde2da" />
          ))}
          <rect x="34" y="52" width="20" height="5" fill={accent} />
          <rect x="6" y="62" width="30" height="1.5" fill="#c6ccc4" />
          <rect x="6" y="66" width="24" height="1.5" fill="#c6ccc4" />
        </>
      )}
    </svg>
  );
}

/** Template choice and the design fields it uses, for the business form. */
export function TemplateFields({
  form,
  update,
}: {
  form: Business;
  update: (key: keyof Business, value: string) => void;
}) {
  const [previewing, setPreviewing] = useState(false);
  const template = templateOf(form);
  const color = (key: "accent" | "secondaryAccent", label: string) => (
    <Field label={label}>
      <div className="color-field">
        <input
          type="color"
          value={form[key]}
          onChange={(e) => update(key, e.target.value)}
        />
        <span>{form[key].toUpperCase()}</span>
      </div>
    </Field>
  );
  const text = (
    key: "closingMessage" | "signatoryName" | "signatoryTitle",
    label: string,
    max: number,
    hint?: string,
  ) => (
    <Field label={label} hint={hint}>
      <input
        value={form[key]}
        maxLength={max}
        onChange={(e) => update(key, e.target.value)}
      />
    </Field>
  );
  return (
    <div className="form-section">
      <h3>Document design</h3>
      <p>
        How this business’s invoices and quotations look. Issued documents keep
        the design they were issued with.
      </p>
      <div
        className="template-options"
        role="radiogroup"
        aria-label="Document template"
      >
        {DOCUMENT_TEMPLATES.map((t) => (
          <label
            key={t.id}
            className={`template-option ${template === t.id ? "selected" : ""}`}
          >
            <input
              type="radio"
              className="sr-only"
              name="document-template"
              value={t.id}
              checked={template === t.id}
              onChange={() => update("template", t.id)}
            />
            <Thumbnail
              id={t.id}
              accent={form.accent}
              secondary={form.secondaryAccent}
            />
            <span>
              <strong>{t.name}</strong>
              <small>{t.description}</small>
            </span>
          </label>
        ))}
      </div>
      <div className="form-grid">
        {color(
          "accent",
          template === "executive" ? "Main colour" : "Document accent colour",
        )}
        {template === "executive" && (
          <>
            {color("secondaryAccent", "Second colour")}
            {text(
              "closingMessage",
              "Closing message",
              80,
              "Shown beside the total, e.g. “Thank you for your service!”. Leave empty to hide it.",
            )}
            {text(
              "signatoryName",
              "Signatory name",
              60,
              "Signed in a handwriting style above the signature line. Leave empty to hide the signature.",
            )}
            {text("signatoryTitle", "Signatory title", 60)}
          </>
        )}
      </div>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setPreviewing(true)}
      >
        <Eye size={16} />
        Preview design
      </Button>
      <Modal
        open={previewing}
        onOpenChange={setPreviewing}
        title="Sample invoice"
        description="Fictional example data, shown in this business’s design. Nothing is saved."
        wide
      >
        {previewing && <DocumentPreview doc={sampleDocument(form)} />}
      </Modal>
    </div>
  );
}
