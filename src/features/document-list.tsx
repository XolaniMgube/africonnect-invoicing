"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  FileText,
  Plus,
  ChevronRight,
  Building2,
} from "lucide-react";
import { useData } from "@/components/provider";
import {
  Badge,
  BusinessMark,
  Button,
  Empty,
  Field,
  Modal,
  SearchBox,
} from "@/components/ui";
import { money, dateLabel } from "@/domain/documents";
import type { BusinessDocument } from "@/domain/types";
export function CreateDocument({
  businessId,
  label = "Create document",
}: {
  businessId?: string;
  label?: string;
}) {
  const { db } = useData();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(businessId || "");
  const [kind, setKind] = useState<BusinessDocument["kind"]>("invoice");
  const [query, setQuery] = useState("");
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={17} />
        {label}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Let’s create a document"
        description="Choose the issuing business and the document you need."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setOpen(false);
            router.push(`/businesses/${selected}/documents/new?kind=${kind}`);
          }}
        >
          <Field label="Document type">
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
          {!businessId && (
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder="Find an issuing business…"
            />
          )}
          <Field label="Issuing client business">
            <select
              required
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Choose a business</option>
              {db?.businesses
                .filter(
                  (b) =>
                    !b.archived &&
                    (b.id === selected ||
                      b.name.toLowerCase().includes(query.toLowerCase())),
                )
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </Field>
          <div className="info-note">
            <Building2 size={19} />
            <span>
              The document will use this business’s branding and banking
              details.
            </span>
          </div>
          <div className="dialog-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit">
              Continue
              <ArrowRight size={17} />
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
export function DocumentList({ businessId }: { businessId?: string }) {
  const { db } = useData();
  const [kind, setKind] = useState<BusinessDocument["kind"]>("invoice");
  const [query, setQuery] = useState("");
  const [business, setBusiness] = useState("");
  const [status, setStatus] = useState("");
  if (!db) return null;
  const docs = db.documents
    .filter(
      (d) =>
        d.kind === kind &&
        (!businessId || d.businessId === businessId) &&
        (!business || d.businessId === business) &&
        (!status || d.status === status) &&
        `${d.number} ${d.snapshot.issuer.name} ${d.snapshot.customer.name}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const total = db.documents.filter(
    (d) => d.kind === kind && (!businessId || d.businessId === businessId),
  ).length;
  return (
    <section className="card document-list">
      <div className="list-heading">
        <div>
          <h2>{businessId ? "Business documents" : "All documents"}</h2>
          <p>
            {businessId
              ? "Every quotation and invoice, in one place."
              : "A clear view of the work across your client businesses."}
          </p>
        </div>
        <span className="subtle-label">
          {total} {kind}s
        </span>
      </div>
      <div className="tabs" role="tablist" aria-label="Document type">
        <button
          role="tab"
          aria-selected={kind === "invoice"}
          className={kind === "invoice" ? "selected" : ""}
          onClick={() => setKind("invoice")}
        >
          <FileText size={16} />
          Invoices
          <span>
            {
              db.documents.filter(
                (d) =>
                  d.kind === "invoice" &&
                  (!businessId || d.businessId === businessId),
              ).length
            }
          </span>
        </button>
        <button
          role="tab"
          aria-selected={kind === "quotation"}
          className={kind === "quotation" ? "selected" : ""}
          onClick={() => setKind("quotation")}
        >
          <FileText size={16} />
          Quotations
          <span>
            {
              db.documents.filter(
                (d) =>
                  d.kind === "quotation" &&
                  (!businessId || d.businessId === businessId),
              ).length
            }
          </span>
        </button>
      </div>
      <div className="filters">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search document, business or customer…"
        />
        {!businessId && (
          <select
            aria-label="Filter by client business"
            value={business}
            onChange={(e) => setBusiness(e.target.value)}
          >
            <option value="">All client businesses</option>
            {db.businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="issued">Issued</option>
        </select>
      </div>
      {docs.length ? (
        <div className="table-scroll">
          <table className="doc-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>
                  {businessId ? "Customer" : "Client business / Customer"}
                </th>
                <th>Date</th>
                <th className="numeric">Amount</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td className="cell-doc">
                    <Link className="doc-number" href={`/documents/${doc.id}`}>
                      <span className={`doc-icon ${doc.kind}`}>
                        <FileText size={17} />
                      </span>
                      <span>
                        {doc.number}
                        <small>
                          {doc.kind === "invoice" ? "Invoice" : "Quotation"}
                        </small>
                      </span>
                    </Link>
                  </td>
                  <td className="cell-party">
                    <div className="table-business">
                      {!businessId && (
                        <BusinessMark business={doc.snapshot.issuer} small />
                      )}
                      <div>
                        <strong>
                          {businessId
                            ? doc.snapshot.customer.name
                            : doc.snapshot.issuer.name}
                        </strong>
                        <small>
                          {businessId
                            ? doc.snapshot.customer.email
                            : doc.snapshot.customer.name}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td className="muted nowrap cell-date">
                    {dateLabel(doc.date)}
                  </td>
                  <td className="numeric amount cell-amount">
                    {money(doc.totals.total)}
                  </td>
                  <td className="cell-status">
                    <Badge status={doc.status} />
                  </td>
                  <td className="cell-actions">
                    <Link
                      className="icon-btn"
                      href={`/documents/${doc.id}`}
                      aria-label={`Open ${doc.number}`}
                    >
                      <ChevronRight size={18} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title={`No ${kind}s found`}
          description="Try another search or filter, or start a new document."
        >
          <Button
            variant="secondary"
            onClick={() => {
              setQuery("");
              setBusiness("");
              setStatus("");
            }}
          >
            Clear filters
          </Button>
        </Empty>
      )}
      <div className="table-footer">
        <span>
          Showing {docs.length} {kind}
          {docs.length !== 1 ? "s" : ""}
        </span>
        <span>All amounts in ZAR</span>
      </div>
    </section>
  );
}
