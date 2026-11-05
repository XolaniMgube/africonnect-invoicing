"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  FileCheck2,
  Files,
  PencilLine,
  ArrowUpRight,
  ArrowRight,
  CalendarDays,
} from "lucide-react";
import { useData } from "@/components/provider";
import { BusinessMark, PageHeading, TextLink } from "@/components/ui";
import { money, today, dateLabel } from "@/domain/documents";
import { CreateDocument, DocumentList } from "./document-list";
import { AddBusiness } from "./businesses";
export function Overview() {
  const { db } = useData();
  const params = useSearchParams();
  if (!db) return null;
  const active = db.businesses.filter((b) => !b.archived);
  const issued = db.documents.filter(
    (d) => d.kind === "invoice" && d.status === "issued",
  );
  const drafts = db.documents.filter((d) => d.status === "draft");
  const cards = [
    {
      label: "Issued invoice value",
      value: money(issued.reduce((n, d) => n + d.totals.total, 0)),
      hint: `${issued.length} issued invoices · not payments received`,
      Icon: FileCheck2,
      cls: "green",
    },
    {
      label: "Client businesses",
      value: active.length,
      hint: "Active businesses in your workspace",
      Icon: Building2,
      cls: "blue",
    },
    {
      label: "Documents created",
      value: db.documents.length,
      hint: `${db.documents.filter((d) => d.kind === "invoice").length} invoices · ${db.documents.filter((d) => d.kind === "quotation").length} quotations`,
      Icon: Files,
      cls: "purple",
    },
    {
      label: "Drafts to finish",
      value: drafts.length,
      hint: "Ready for your next review",
      Icon: PencilLine,
      cls: "amber",
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="YOUR WORK, CONNECTED"
        title="Workspace overview"
        description="Every client business. Every document. One clear view."
      >
        <AddBusiness variant="secondary" />
        <CreateDocument />
      </PageHeading>
      <section className="overview-banner">
        <div>
          <span className="banner-label">
            <span /> AFRICONNECT INVOICING
          </span>
          <h2>Keep business moving.</h2>
          <p>
            From the first quotation to the final invoice,
            <br className="desktop-break" /> make every document count.
          </p>
          <Link href="/businesses">
            Explore your client businesses
            <ArrowRight size={17} />
          </Link>
        </div>
        <div className="banner-art" aria-hidden="true">
          <div className="paper-back" />
          <div className="paper-front">
            <div className="paper-logo">
              <FileCheck2 size={21} />
              <span>INVOICE</span>
              <span className="paper-dots">•••</span>
            </div>
            <div className="paper-line long" />
            <div className="paper-line short" />
            <div className="paper-row">
              <span />
              <span />
            </div>
            <div className="paper-row">
              <span />
              <span />
            </div>
            <div className="paper-total">
              <span>TOTAL</span>
              <span>All connected.</span>
            </div>
          </div>
          <span className="art-check">
            <FileCheck2 size={25} />
          </span>
        </div>
        <div className="banner-date">
          <CalendarDays size={15} />
          {dateLabel(today())}
        </div>
      </section>
      <div className="stats-grid">
        {cards.map(({ label, value, hint, Icon, cls }) => (
          <div className="stat-card" key={label}>
            <div className="stat-top">
              <span>{label}</span>
              <span className={`stat-icon ${cls}`}>
                <Icon size={19} />
              </span>
            </div>
            <strong>{value}</strong>
            <small>{hint}</small>
          </div>
        ))}
      </div>
      <div className="section-heading">
        <div>
          <h2>
            Your client businesses{" "}
            <span className="count-bubble">{active.length}</span>
          </h2>
          <p>A dedicated workspace for every business you support.</p>
        </div>
        <TextLink href="/businesses">View all businesses</TextLink>
      </div>
      <div className="business-strip">
        {active.slice(0, 4).map((b) => (
          <Link
            href={`/businesses/${b.id}`}
            className="business-mini"
            key={b.id}
          >
            <div>
              <BusinessMark business={b} />
              <ArrowUpRight size={18} />
            </div>
            <h3>{b.name}</h3>
            <p>{b.industry}</p>
            <div className="business-mini-footer">
              <span>
                {db.documents.filter((d) => d.businessId === b.id).length}{" "}
                documents
              </span>
              <span>
                Open workspace <ArrowRight size={13} />
              </span>
            </div>
          </Link>
        ))}
      </div>
      <DocumentList
        key={params.get("tab") || "invoice"}
        initialKind={
          params.get("tab") === "quotation" ? "quotation" : "invoice"
        }
      />
    </>
  );
}
