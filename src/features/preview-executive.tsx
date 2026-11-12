import Image from "next/image";
import type { BusinessDocument } from "@/domain/types";
import { calculate, dateLabel, money } from "@/domain/documents";
import { BusinessMark } from "@/components/ui";

/** Bottom band: main colour, then two slanted stripes in the second colour. */
export function ExecutiveBand({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 595 30"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon points="0,0 350,0 380,30 0,30" fill="var(--exec-main)" />
      <polygon points="362,0 380,0 410,30 392,30" fill="var(--exec-second)" />
      <polygon points="392,0 595,0 595,30 422,30" fill="var(--exec-second)" />
    </svg>
  );
}

/**
 * The Executive template on screen. It mirrors `src/pdf/executive-pdf.tsx`:
 * same data, labels, sections and calculations.
 */
export function ExecutivePreview({ doc }: { doc: BusinessDocument }) {
  const { issuer, customer } = doc.snapshot;
  const totals = calculate(doc.lines, doc.taxRate, doc.discountAmount);
  const invoice = doc.kind === "invoice";
  const draft = doc.status === "draft";
  const word = invoice ? "Invoice" : "Quotation";
  const hasBank =
    invoice && [issuer.bank, issuer.accountNumber].some((v) => v.trim());
  const breakdown = doc.discountAmount > 0 || doc.taxRate > 0;
  return (
    <article
      className={`document-paper exec-paper ${draft ? "is-draft" : ""}`}
      style={
        {
          "--exec-main": issuer.accent,
          "--exec-second": issuer.secondaryAccent,
        } as React.CSSProperties
      }
      aria-label={`${word} preview`}
    >
      {draft && (
        <span className="paper-watermark" aria-hidden="true">
          DRAFT
        </span>
      )}
      <header className="exec-head">
        <div className="exec-brand">
          {issuer.logo ? (
            <Image
              className="exec-logo"
              src={issuer.logo}
              alt={`${issuer.name} logo`}
              width={180}
              height={90}
              unoptimized
            />
          ) : (
            <>
              <BusinessMark business={issuer} />
              <strong>{issuer.name}</strong>
            </>
          )}
        </div>
        <div className="exec-title">
          <h2>{word.toUpperCase()}</h2>
          {issuer.email && <span>{issuer.email}</span>}
          {draft && <span className="draft-stamp">DRAFT · NOT ISSUED</span>}
        </div>
      </header>
      <div className="exec-divider" aria-hidden="true">
        <span />
        <span />
      </div>
      <section className="exec-parties">
        <div>
          <small>{word} to :</small>
          <strong>{customer.name || "Select a customer"}</strong>
          {customer.contact && <p>Attn: {customer.contact}</p>}
          {customer.address && (
            <p className="preserve-lines">{customer.address}</p>
          )}
          {customer.phone && <p>{customer.phone}</p>}
          {customer.email && <p>{customer.email}</p>}
          {customer.registration && (
            <p>Registration: {customer.registration}</p>
          )}
          {customer.vat && <p>Tax number: {customer.vat}</p>}
        </div>
        <dl>
          <dt>{word} Date</dt>
          <dd>{dateLabel(doc.date)}</dd>
          <dt>{word} No</dt>
          <dd>{doc.number || "Assigned on issue"}</dd>
          {doc.sourceQuotationNumber && (
            <>
              <dt>Quotation Ref</dt>
              <dd>{doc.sourceQuotationNumber}</dd>
            </>
          )}
        </dl>
      </section>
      <table className="exec-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l) => (
            <tr key={l.id}>
              <td>
                {l.name || "Untitled item"}
                {l.description && (
                  <p className="preserve-lines">{l.description}</p>
                )}
              </td>
              <td>
                {Number.isFinite(l.quantity) ? l.quantity : "—"}
                {l.unit && l.unit !== "Item" && ` ${l.unit}`}
              </td>
              <td>{Number.isFinite(l.price) ? money(l.price) : "—"}</td>
              <td>{money(calculate([l], 0).total)}</td>
            </tr>
          ))}
          {!doc.lines.length && (
            <tr>
              <td colSpan={4} className="exec-empty">
                No line items yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="exec-summary">
        <p className="exec-closing">{issuer.closingMessage}</p>
        <div className="exec-totals">
          {breakdown && (
            <>
              <div>
                <span>Subtotal</span>
                <span>{money(totals.subtotal)}</span>
              </div>
              {doc.discountAmount > 0 && (
                <div>
                  <span>Discount</span>
                  <span>−{money(doc.discountAmount)}</span>
                </div>
              )}
              {doc.taxRate > 0 && (
                <div>
                  <span>VAT ({doc.taxRate}%)</span>
                  <span>{money(totals.tax)}</span>
                </div>
              )}
            </>
          )}
          <div className="exec-total">
            <span>Total</span>
            <strong>{money(totals.total)}</strong>
          </div>
        </div>
      </div>
      {hasBank && (
        <div className="exec-payment">
          <strong>PAYMENT DETAILS</strong>
          {issuer.bank && (
            <p>
              Bank Name: <b>{issuer.bank}</b>
            </p>
          )}
          {issuer.accountNumber && (
            <p>
              Account No: <b>{issuer.accountNumber}</b>
            </p>
          )}
          {issuer.accountName && (
            <p>
              Account Holder: <b>{issuer.accountName}</b>
            </p>
          )}
          {issuer.branch && (
            <p>
              Branch Code: <b>{issuer.branch}</b>
            </p>
          )}
          <p>
            Reference: <b>{doc.number || "Draft"}</b>
          </p>
        </div>
      )}
      {(doc.terms || doc.notes) && (
        <div className="exec-notes">
          {doc.terms && <p>{doc.terms}</p>}
          {doc.notes && <p className="preserve-lines">{doc.notes}</p>}
        </div>
      )}
      <footer className="exec-footer">
        <div className="exec-contact">
          <strong>CONTACT US</strong>
          {issuer.phone && <p>{issuer.phone}</p>}
          {issuer.address && <p>{issuer.address.split(/\n+/).join(", ")}</p>}
          {issuer.email && <p>{issuer.email}</p>}
          {issuer.registration && <small>Reg. {issuer.registration}</small>}
          {issuer.vat && <small>VAT {issuer.vat}</small>}
        </div>
        {issuer.signatoryName.trim() && (
          <div className="exec-signature">
            <span className="exec-sign">{issuer.signatoryName}</span>
            <strong>{issuer.signatoryName}</strong>
            {issuer.signatoryTitle && <small>{issuer.signatoryTitle}</small>}
          </div>
        )}
      </footer>
      <ExecutiveBand className="exec-band" />
    </article>
  );
}
