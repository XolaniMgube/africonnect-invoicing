"use client";
import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronRight, Wallet } from "lucide-react";
import { useData } from "@/components/provider";
import { Empty, PageHeading } from "@/components/ui";
import { dateLabel, money, today } from "@/domain/documents";
import { openInvoices, summarise } from "@/domain/receivables";
import { StatusBadge } from "./payments";

/** Money owed on super businesses' issued invoices. */
export function Receivables() {
  const { db } = useData();
  const [businessId, setBusinessId] = useState("");
  const [customerKey, setCustomerKey] = useState("");
  if (!db) return null;
  const supers = db.businesses.filter((b) => b.isSuper);
  if (!supers.length)
    return (
      <Empty
        title="No super businesses"
        description="Receivables cover super businesses. An admin can mark one on the Users & access page."
      />
    );
  const on = today();
  const all = openInvoices(db, on);
  const forBusiness = all.filter(
    (r) => !businessId || r.doc.businessId === businessId,
  );
  const rows = forBusiness.filter(
    (r) =>
      !customerKey || `${r.doc.businessId}:${r.doc.customerId}` === customerKey,
  );
  const totals = summarise(rows);
  const customers = summarise(forBusiness).customers;

  return (
    <>
      <PageHeading
        eyebrow="SUPER BUSINESSES"
        title="Receivables"
        description="Money still owed on issued invoices. Paid, cancelled and superseded invoices are left out."
      />
      <div className="receivables-filters">
        <select
          aria-label="Filter by business"
          value={businessId}
          onChange={(e) => {
            setBusinessId(e.target.value);
            setCustomerKey("");
          }}
        >
          <option value="">All super businesses</option>
          {supers.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by customer"
          value={customerKey}
          onChange={(e) => setCustomerKey(e.target.value)}
        >
          <option value="">All customers</option>
          {customers.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="stats-grid receivables-stats">
        <div className="stat-card">
          <div className="stat-top">
            <span>Outstanding</span>
            <span className="stat-icon blue">
              <Wallet size={19} />
            </span>
          </div>
          <strong>{money(totals.outstanding)}</strong>
          <small>
            {rows.length} open {rows.length === 1 ? "invoice" : "invoices"}
          </small>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span>Overdue</span>
            <span className="stat-icon amber">
              <AlertTriangle size={19} />
            </span>
          </div>
          <strong>{money(totals.overdue)}</strong>
          <small>
            {totals.overdueCount} overdue{" "}
            {totals.overdueCount === 1 ? "invoice" : "invoices"}
          </small>
        </div>
      </div>
      <section className="card receivables-aging" aria-label="Overdue by age">
        {totals.buckets.map((b) => (
          <div key={b.id} className={`aging-${b.id}`}>
            <span>{b.label}</span>
            <strong>{money(b.amount)}</strong>
            <small>
              {b.count} {b.count === 1 ? "invoice" : "invoices"}
            </small>
          </div>
        ))}
      </section>
      <div className="receivables-layout">
        <section className="card receivables-list">
          <h2>Open invoices</h2>
          {rows.length ? (
            <div className="table-scroll">
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Due</th>
                    <th className="numeric">Balance due</th>
                    <th>Status</th>
                    <th aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.doc.id}>
                      <td className="cell-primary">
                        <strong>{r.doc.number}</strong>
                        <small className="muted">
                          {r.doc.snapshot.issuer.name}
                        </small>
                      </td>
                      <td data-label="Customer">
                        {r.doc.snapshot.customer.name}
                      </td>
                      <td data-label="Due">
                        {dateLabel(r.dueDate)}
                        <small className="muted receivables-days">
                          {r.daysOverdue
                            ? `${r.daysOverdue} ${r.daysOverdue === 1 ? "day" : "days"} overdue`
                            : "Not yet due"}
                        </small>
                      </td>
                      <td className="numeric" data-label="Balance due">
                        <strong>{money(r.balance)}</strong>
                      </td>
                      <td data-label="Status">
                        <StatusBadge db={db} doc={r.doc} />
                      </td>
                      <td className="cell-actions">
                        <Link
                          className="icon-btn"
                          href={`/documents/${r.doc.id}`}
                          aria-label={`Open ${r.doc.number}`}
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
              title="Nothing owed"
              description="Every issued invoice here is paid, cancelled or superseded."
            />
          )}
        </section>
        <section className="card receivables-customers">
          <h2>Owed by customer</h2>
          {totals.customers.length ? (
            <ul>
              {totals.customers.map((c) => (
                <li key={c.key}>
                  <span>
                    <strong>{c.name}</strong>
                    <small>
                      {c.count} {c.count === 1 ? "invoice" : "invoices"}
                      {c.overdue > 0 && ` · ${money(c.overdue)} overdue`}
                    </small>
                  </span>
                  <strong>{money(c.balance)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No customer owes anything.</p>
          )}
        </section>
      </div>
    </>
  );
}
