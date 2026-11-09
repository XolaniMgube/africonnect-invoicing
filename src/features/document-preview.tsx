import type { BusinessDocument } from "@/domain/types";
import { calculate, dateLabel, money } from "@/domain/documents";
import Image from "next/image";
import { BusinessMark } from "@/components/ui";

/**
 * On-screen rendering of a document. It mirrors the PDF template in
 * `src/pdf/document-pdf.tsx`: same data, labels, sections and calculations.
 */
export function DocumentPreview({ doc }: { doc: BusinessDocument }) {
  const { issuer, customer } = doc.snapshot;
  const totals = calculate(doc.lines, doc.taxRate);
  const invoice = doc.kind === "invoice";
  const draft = doc.status === "draft";
  const hasBank =
    invoice && [issuer.bank, issuer.accountNumber].some((v) => v.trim());
  return (
    <article
      className={`document-paper ${draft ? "is-draft" : ""}`}
      style={{ "--document-accent": issuer.accent } as React.CSSProperties}
      aria-label={`${invoice ? "Invoice" : "Quotation"} preview`}
    >
      {draft && (
        <span className="paper-watermark" aria-hidden="true">
          DRAFT
        </span>
      )}
      <div className="paper-heading">
        <div>
          {issuer.logo ? (
            // Natural proportions, up to 130 px each way (PDF: 120 pt).
            <Image
              className="paper-issuer-logo"
              src={issuer.logo}
              alt={`${issuer.name} logo`}
              width={130}
              height={130}
              unoptimized
            />
          ) : (
            <BusinessMark business={issuer} />
          )}
          <h2>{issuer.name}</h2>
          <p className="preserve-lines">{issuer.address}</p>
          <p>{[issuer.email, issuer.phone].filter(Boolean).join("  |  ")}</p>
          {issuer.registration && <p>Registration: {issuer.registration}</p>}
          {issuer.vat && <p>VAT number: {issuer.vat}</p>}
        </div>
        <div className="paper-title">
          <h2>{invoice ? "INVOICE" : "QUOTATION"}</h2>
          <strong>{doc.number || "Number assigned on save"}</strong>
          {draft && <span className="draft-stamp">DRAFT · NOT ISSUED</span>}
        </div>
      </div>
      <div className="paper-parties">
        <div>
          <small>{invoice ? "BILL TO" : "PREPARED FOR"}</small>
          <strong>{customer.name || "Select a customer"}</strong>
          {customer.contact && <p>Attn: {customer.contact}</p>}
          {customer.address && (
            <p className="preserve-lines">{customer.address}</p>
          )}
          {(customer.email || customer.phone) && (
            <p>
              {customer.email}
              {customer.email && customer.phone && <br />}
              {customer.phone}
            </p>
          )}
          {customer.registration && (
            <p>Registration: {customer.registration}</p>
          )}
          {customer.vat && <p>Tax number: {customer.vat}</p>}
        </div>
        <div>
          <small>{invoice ? "INVOICE DETAILS" : "QUOTATION DETAILS"}</small>
          <dl className="paper-details">
            <dt>{invoice ? "Invoice date" : "Quotation date"}</dt>
            <dd>{dateLabel(doc.date)}</dd>
            {doc.sourceQuotationNumber && (
              <>
                <dt>Quotation ref.</dt>
                <dd>{doc.sourceQuotationNumber}</dd>
              </>
            )}
          </dl>
          {doc.terms && <p>{doc.terms}</p>}
        </div>
      </div>
      <div className="paper-table-wrap">
        <table className="paper-table">
          <thead>
            <tr>
              <th>Description</th>
              <th className="numeric">Qty / unit</th>
              <th className="numeric">Unit price</th>
              <th className="numeric">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l) => (
              <tr key={l.id}>
                <td data-label="Item">
                  <strong>{l.name || "Untitled item"}</strong>
                  {l.description && (
                    <p className="preserve-lines">{l.description}</p>
                  )}
                </td>
                <td className="numeric" data-label="Qty / unit">
                  {Number.isFinite(l.quantity) ? l.quantity : "—"} {l.unit}
                </td>
                <td className="numeric" data-label="Unit price">
                  {Number.isFinite(l.price) ? money(l.price) : "—"}
                </td>
                <td className="numeric" data-label="Amount">
                  {money(calculate([l], 0).total)}
                </td>
              </tr>
            ))}
            {!doc.lines.length && (
              <tr>
                <td colSpan={4} className="paper-empty">
                  No line items yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="paper-totals">
        <div>
          <span>Subtotal</span>
          <strong>{money(totals.subtotal)}</strong>
        </div>
        {doc.taxRate > 0 && (
          <div>
            <span>VAT ({doc.taxRate}%)</span>
            <strong>{money(totals.tax)}</strong>
          </div>
        )}
        <div className="grand">
          <span>{invoice ? "Total due" : "Quoted total"}</span>
          <strong>{money(totals.total)}</strong>
        </div>
        {!(doc.taxRate > 0) && <small>No VAT charged.</small>}
      </div>
      {hasBank && (
        <div className="paper-notes">
          <small>PAYMENT DETAILS</small>
          <p>
            {issuer.bank && (
              <>
                Bank: {issuer.bank}
                <br />
              </>
            )}
            {issuer.accountName && (
              <>
                Account holder: {issuer.accountName}
                <br />
              </>
            )}
            {issuer.accountNumber && (
              <>
                Account number: {issuer.accountNumber}
                {issuer.branch && ` · Branch code: ${issuer.branch}`}
                <br />
              </>
            )}
            Payment reference: {doc.number || "Draft"}
          </p>
        </div>
      )}
      {doc.notes && (
        <div className="paper-notes">
          <small>{invoice ? "NOTES & INSTRUCTIONS" : "TERMS & NOTES"}</small>
          <p className="preserve-lines">{doc.notes}</p>
        </div>
      )}
      <div className="paper-bottom">
        <span>
          {doc.number || "Unnumbered draft"} ·{" "}
          {draft ? "Draft — not issued" : `Issued by ${issuer.name}`}
        </span>
        <span>Amounts in South African rand (ZAR)</span>
      </div>
    </article>
  );
}
