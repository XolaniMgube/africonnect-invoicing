"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Plus, Pencil, Trash2, Users, Package, ArrowLeft } from "lucide-react";
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
  useUnsavedChanges,
  hasVisibleUnsavedChanges,
} from "@/components/unsaved";
import type { Customer, ReferenceItem } from "@/domain/types";
import { units } from "@/domain/types";
import { money } from "@/domain/documents";
export const blankCustomer = (businessId: string): Customer => ({
  id: crypto.randomUUID(),
  businessId,
  name: "",
  contact: "",
  email: "",
  phone: "",
  address: "",
  registration: "",
  vat: "",
});
export function Records({ kind }: { kind: "customers" | "items" }) {
  const { businessId } = useParams<{ businessId: string }>();
  const { db, deleteCustomer, deleteItem } = useData();
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState<Customer | ReferenceItem | null>(null);
  const [remove, setRemove] = useState<Customer | ReferenceItem | null>(null);
  const b = db?.businesses.find((b) => b.id === businessId);
  if (!b || !db)
    return (
      <Empty
        title="Business not found"
        description="Select a client business to see its records."
      />
    );
  const isCustomers = kind === "customers";
  // Documents keep their customer, so a customer in use cannot be deleted.
  const inUse =
    isCustomers && remove
      ? db.documents.filter((d) => d.customerId === remove.id).length
      : 0;
  const records = isCustomers
    ? db.customers.filter(
        (c) =>
          c.businessId === b.id &&
          `${c.name} ${c.email} ${c.contact}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      )
    : db.items.filter(
        (i) =>
          i.businessId === b.id &&
          (!category || i.category === category) &&
          `${i.name} ${i.description} ${i.category}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      );
  function add() {
    setEditing(
      isCustomers
        ? blankCustomer(businessId)
        : {
            id: crypto.randomUUID(),
            businessId,
            name: "",
            description: "",
            category: "",
            unit: "Item",
            price: 0,
          },
    );
  }
  return (
    <>
      <Link className="back-link" href={`/businesses/${b.id}`}>
        <ArrowLeft size={16} />
        Business workspace
      </Link>
      <PageHeading
        title={isCustomers ? "Customers" : "Items & services"}
        description={
          isCustomers
            ? `The people and businesses ${b.name} invoices.`
            : "A reusable catalogue. Document price overrides stay on the document."
        }
      >
        {!b.archived && (
          <Button onClick={add}>
            <Plus size={17} />
            {isCustomers ? "Add customer" : "Add item"}
          </Button>
        )}
      </PageHeading>
      <section className="card">
        <div className="filters">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder={
              isCustomers ? "Search customers…" : "Search items and services…"
            }
          />
          {!isCustomers && (
            <select
              aria-label="Filter category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {[
                ...new Set(
                  db.items
                    .filter((i) => i.businessId === b.id)
                    .map((i) => i.category),
                ),
              ]
                .filter(Boolean)
                .map((c) => (
                  <option key={c}>{c}</option>
                ))}
            </select>
          )}
        </div>
        {records.length ? (
          <div className="table-scroll">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>{isCustomers ? "Customer" : "Item / service"}</th>
                  <th>{isCustomers ? "Email" : "Category"}</th>
                  <th>{isCustomers ? "Phone" : "Default price"}</th>
                  <th>{isCustomers ? "Billing address" : "Unit"}</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td className="cell-primary">
                      <div className="table-business">
                        <span className="record-icon">
                          {isCustomers ? (
                            <Users size={19} />
                          ) : (
                            <Package size={19} />
                          )}
                        </span>
                        <div>
                          <strong>{r.name}</strong>
                          <small>
                            {"contact" in r ? r.contact : r.description}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td data-label={isCustomers ? "Email" : "Category"}>
                      {"email" in r ? r.email || "—" : r.category || "—"}
                    </td>
                    <td data-label={isCustomers ? "Phone" : "Default price"}>
                      {"phone" in r ? r.phone || "—" : money(r.price)}
                    </td>
                    <td
                      data-label={isCustomers ? "Billing address" : "Unit"}
                      className={isCustomers ? "preserve-lines" : ""}
                    >
                      {"address" in r ? r.address || "—" : r.unit}
                    </td>
                    <td className="cell-actions">
                      <div className="actions">
                        <button
                          className="icon-btn"
                          disabled={b.archived}
                          aria-label={`Edit ${r.name}`}
                          onClick={() => setEditing(r)}
                        >
                          <Pencil size={17} />
                        </button>
                        <button
                          className="icon-btn"
                          disabled={b.archived}
                          aria-label={`Delete ${r.name}`}
                          onClick={() => setRemove(r)}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={isCustomers ? "No customers yet" : "No items found"}
            description={
              isCustomers
                ? "Add a customer to start creating documents for this business."
                : "Add the services or products this business provides."
            }
          >
            {!b.archived && (
              <Button onClick={add}>
                {isCustomers ? "Add customer" : "Add item"}
              </Button>
            )}
          </Empty>
        )}
        <div className="table-footer">
          {records.length} {isCustomers ? "customers" : "items"} · {b.name}
        </div>
      </section>
      <Modal
        open={!!editing}
        onOpenChange={(v) => {
          if (
            !v &&
            hasVisibleUnsavedChanges() &&
            !confirm("Discard unsaved changes?")
          )
            return;
          setEditing(null);
        }}
        title={`${db[kind].some((r) => r.id === editing?.id) ? "Edit" : "Add"} ${isCustomers ? "customer" : "item / service"}`}
        description={`Saved only within ${b.name}.`}
        wide
      >
        {editing && (
          <RecordForm initial={editing} onSaved={() => setEditing(null)} />
        )}
      </Modal>
      <Modal
        open={!!remove}
        onOpenChange={() => setRemove(null)}
        title={`Delete ${isCustomers ? "customer" : "item"}?`}
        description={
          inUse
            ? "Customers used on invoices or quotations are kept so those documents stay complete."
            : isCustomers
              ? "This can’t be undone."
              : "This can’t be undone. Invoices and quotations that already use it keep their lines unchanged."
        }
      >
        <p>
          {inUse
            ? `${remove?.name} is used on ${inUse === 1 ? "1 invoice or quotation" : `${inUse} invoices or quotations`} and can’t be deleted.`
            : remove?.name}
        </p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setRemove(null)}>
            {inUse ? "Close" : "Cancel"}
          </Button>
          {!inUse && (
            <Button
              variant="danger"
              disabled={deleting}
              onClick={async () => {
                if (!remove) return;
                setDeleting(true);
                const deleted = isCustomers
                  ? await deleteCustomer(remove.id, "Customer deleted.")
                  : await deleteItem(remove.id, "Item deleted.");
                setDeleting(false);
                if (deleted) setRemove(null);
              }}
            >
              <Trash2 size={16} />
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}
export function RecordForm({
  initial,
  onSaved,
}: {
  initial: Customer | ReferenceItem;
  onSaved: (record: Customer | ReferenceItem) => void;
}) {
  const { saveCustomer, saveItem } = useData();
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const customer = "contact" in form;
  const dirty = !saved && JSON.stringify(initial) !== JSON.stringify(form);
  useUnsavedChanges(dirty);
  const change = (key: string, value: string | number) =>
    setForm((f) => ({ ...f, [key]: value }));
  const input = (
    key: string,
    label: string,
    type = "text",
    required = false,
  ) => (
    <Field label={label}>
      <input
        type={type}
        required={required}
        value={String((form as unknown as Record<string, string>)[key])}
        onChange={(e) => change(key, e.target.value)}
      />
    </Field>
  );
  return (
    <form
      data-unsaved={dirty}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        const record = { ...form, name: form.name.trim() };
        const result = customer
          ? await saveCustomer(record as Customer, "Customer saved.")
          : await saveItem(record as ReferenceItem, "Item saved.");
        setBusy(false);
        if (result) {
          setSaved(true);
          onSaved(result);
        }
      }}
    >
      <div className="form-grid">
        {input(
          "name",
          customer ? "Person / company name" : "Item / service name",
          "text",
          true,
        )}
        {customer ? (
          <>
            {input("contact", "Contact person")}
            {input("email", "Email", "email")}
            {input("phone", "Phone")}
            {input("registration", "Registration details")}
            {input("vat", "Tax details")}
          </>
        ) : (
          <>
            {input("category", "Category")}
            <Field label="Unit of measurement">
              <select
                value={(form as ReferenceItem).unit}
                onChange={(e) => change("unit", e.target.value)}
              >
                {units.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </Field>
            <Field label="Default unit price (R)">
              <input
                type="number"
                required
                min="0"
                max="1000000000"
                step="0.01"
                value={(form as ReferenceItem).price}
                onChange={(e) =>
                  change(
                    "price",
                    e.target.value === "" ? NaN : Number(e.target.value),
                  )
                }
              />
            </Field>
          </>
        )}
      </div>
      <Field label={customer ? "Billing address" : "Description"}>
        <textarea
          rows={3}
          value={
            customer
              ? (form as Customer).address
              : (form as ReferenceItem).description
          }
          onChange={(e) =>
            change(customer ? "address" : "description", e.target.value)
          }
        />
      </Field>
      <div className="dialog-actions">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : `Save ${customer ? "customer" : "item"}`}
        </Button>
      </div>
    </form>
  );
}
