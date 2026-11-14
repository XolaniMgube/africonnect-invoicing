"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { useData } from "@/components/provider";
import { Button, Field, PageHeading } from "@/components/ui";
import {
  DESIGN_DEFAULTS,
  DOCUMENT_TEMPLATES,
  templateOf,
} from "@/domain/templates";
import type {
  Business,
  BusinessDocument,
  DocumentTemplate,
} from "@/domain/types";
import { DocumentPreview } from "./document-preview";
import { sampleDocument, Thumbnail } from "./template-picker";

/** Fictional issuer used for every template preview. */
const SAMPLE_BUSINESS: Business = {
  id: "sample-business",
  name: "Sample Trading Co",
  industry: "",
  logo: "",
  accent: "#0F2340",
  ...DESIGN_DEFAULTS,
  signatoryName: "A. Sample",
  signatoryTitle: "Director",
  email: "hello@sample.example",
  phone: "+27 00 000 0000",
  address: "10 Example Road\nSandton, 2196",
  registration: "",
  vat: "",
  bank: "Example Bank",
  accountName: "Sample Trading Co",
  accountNumber: "0000000000",
  branch: "",
  archived: false,
  isSuper: false,
  emailFrom: "",
  autoReminders: false,
  reminderOffsets: [0, 7, 14],
  taxRate: 15,
  invoicePrefix: "INV",
  quotationPrefix: "QUO",
  paymentDays: 30,
  validityDays: 14,
  notes: "",
};

/**
 * Workspace-wide view of the document templates, previewed with fictional
 * sample details. Each business picks its template in its own settings.
 */
export function Templates() {
  const { db } = useData();
  const [selected, setSelected] = useState<DocumentTemplate>("executive");
  const [kind, setKind] = useState<BusinessDocument["kind"]>("invoice");
  const [pdfBusy, setPdfBusy] = useState(false);
  if (!db) return null;
  const active = db.businesses.filter((b) => !b.archived);
  const doc = sampleDocument({ ...SAMPLE_BUSINESS, template: selected }, kind);

  async function downloadSample() {
    setPdfBusy(true);
    try {
      const { downloadPDF } = await import("@/pdf/document-pdf");
      await downloadPDF(doc);
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="DOCUMENT DESIGN"
        title="Templates"
        description="Preview each invoice and quotation design. Each business chooses its template, colours and signature in its settings; issued documents keep the design they were issued with."
      />
      <div className="templates-layout">
        <section
          className="card templates-list"
          role="radiogroup"
          aria-label="Templates"
        >
          {DOCUMENT_TEMPLATES.map((t) => {
            const count = active.filter((b) => templateOf(b) === t.id).length;
            return (
              <label
                key={t.id}
                className={`template-option ${selected === t.id ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name="template-gallery"
                  value={t.id}
                  checked={selected === t.id}
                  onChange={() => setSelected(t.id)}
                />
                <Thumbnail
                  id={t.id}
                  accent={SAMPLE_BUSINESS.accent}
                  secondary={SAMPLE_BUSINESS.secondaryAccent}
                />
                <span>
                  <strong>{t.name}</strong>
                  <small>{t.description}</small>
                  <small className="template-usage">
                    Used by {count} {count === 1 ? "business" : "businesses"}
                  </small>
                </span>
              </label>
            );
          })}
        </section>
        <section className="card templates-preview">
          <div className="templates-controls">
            <Field label="Document">
              <select
                value={kind}
                onChange={(e) =>
                  setKind(e.target.value as BusinessDocument["kind"])
                }
              >
                <option value="invoice">Invoice</option>
                <option value="quotation">Quotation</option>
              </select>
            </Field>
            <Button
              variant="secondary"
              disabled={pdfBusy}
              onClick={() => void downloadSample()}
            >
              <Download size={16} />
              {pdfBusy ? "Preparing PDF…" : "Download sample PDF"}
            </Button>
          </div>
          <p className="muted templates-note">
            Shown with fictional sample details.
          </p>
          <DocumentPreview doc={doc} />
        </section>
      </div>
    </>
  );
}
