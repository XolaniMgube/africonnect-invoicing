"use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  ArrowUpRight,
  Building2,
  Users,
  Package,
  Settings2,
  Archive,
  RotateCcw,
  Upload,
  Mail,
  ArrowLeft,
} from "lucide-react";
import { useData } from "@/components/provider";
import {
  Button,
  BusinessMark,
  Empty,
  Field,
  Modal,
  PageHeading,
  SearchBox,
  Badge,
} from "@/components/ui";
import {
  useUnsavedChanges,
  hasVisibleUnsavedChanges,
} from "@/components/unsaved";
import { LOGO_MAX_BYTES } from "@/data/errors";
import { validateBusiness } from "@/domain/businesses";
import type { Business } from "@/domain/types";
import { CreateDocument, DocumentList } from "./document-list";
export const newBusiness = (): Business => ({
  id: crypto.randomUUID(),
  name: "",
  industry: "",
  logo: "",
  accent: "#286044",
  email: "",
  phone: "",
  address: "",
  registration: "",
  vat: "",
  bank: "",
  accountName: "",
  accountNumber: "",
  branch: "",
  archived: false,
  taxRate: 0,
  invoicePrefix: "INV",
  quotationPrefix: "QUO",
  paymentDays: 30,
  validityDays: 14,
  notes: "",
});
/** "Add business" button and dialog; after saving, opens the new workspace. */
export function AddBusiness({
  variant = "primary",
}: {
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus size={17} />
        Add business
      </Button>
      <Modal
        open={open}
        onOpenChange={(v) => {
          if (
            !v &&
            hasVisibleUnsavedChanges() &&
            !confirm("Discard unsaved business details?")
          )
            return;
          setOpen(v);
        }}
        title="Add a client business"
        description="Set up the business that will appear as the issuer on its documents."
        wide
      >
        <BusinessForm
          onSaved={(saved) => {
            setOpen(false);
            router.push(`/businesses/${saved.id}`);
          }}
        />
      </Modal>
    </>
  );
}
export function Businesses() {
  const { db, setBusinessArchived } = useData();
  const [archiving, setArchiving] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [archive, setArchive] = useState<Business | null>(null);
  if (!db) return null;
  const records = db.businesses.filter(
    (b) =>
      (filter === "all" ||
        (filter === "archived" ? b.archived : !b.archived)) &&
      `${b.name} ${b.industry}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="BUSINESSES YOU SUPPORT"
        title="Client businesses"
        description="Their identity. Their customers. A workspace for every business."
      >
        <AddBusiness />
      </PageHeading>
      <div className="filters standalone">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search business name or industry…"
        />
        <select
          aria-label="Business status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="active">Active businesses</option>
          <option value="archived">Archived businesses</option>
          <option value="all">All businesses</option>
        </select>
        <span className="muted">{records.length} businesses</span>
      </div>
      <div className="business-grid">
        {records.map((b) => (
          <article className="card business-card" key={b.id}>
            <div className="flex justify-between items-center">
              <BusinessMark business={b} />
              <Badge status={b.archived ? "archived" : "active"} />
            </div>
            <h2>{b.name}</h2>
            <p>{b.industry || "Client business"}</p>
            <div className="business-contact">
              <Mail size={15} />
              {b.email || "No email added"}
            </div>
            <div className="business-card-stats">
              <div>
                <strong>
                  {db.customers.filter((c) => c.businessId === b.id).length}
                </strong>
                <span>Customers</span>
              </div>
              <div>
                <strong>
                  {db.documents.filter((d) => d.businessId === b.id).length}
                </strong>
                <span>Documents</span>
              </div>
              <div>
                <strong>{b.taxRate ? `${b.taxRate}%` : "No VAT"}</strong>
                <span>Default tax</span>
              </div>
            </div>
            <div className="business-card-actions">
              <Link className="btn secondary" href={`/businesses/${b.id}`}>
                Open workspace
                <ArrowUpRight size={16} />
              </Link>
              <Link
                className="icon-btn"
                href={`/businesses/${b.id}/settings`}
                aria-label={`Edit ${b.name}`}
              >
                <Settings2 size={18} />
              </Link>
              <button
                className="icon-btn"
                aria-label={`${b.archived ? "Restore" : "Archive"} ${b.name}`}
                onClick={() => setArchive(b)}
              >
                {b.archived ? <RotateCcw size={18} /> : <Archive size={18} />}
              </button>
            </div>
          </article>
        ))}
      </div>
      {!records.length && (
        <Empty
          title="No businesses found"
          description="Try another search or add your first client business."
        >
          <AddBusiness variant="secondary" />
        </Empty>
      )}
      <Modal
        open={!!archive}
        onOpenChange={() => setArchive(null)}
        title={`${archive?.archived ? "Restore" : "Archive"} business?`}
        description={
          archive?.archived
            ? "This business will be available for creating documents again."
            : "Historical documents are preserved. New documents and edits will be paused until the business is restored."
        }
      >
        <p>{archive?.name}</p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setArchive(null)}>
            Cancel
          </Button>
          <Button
            disabled={archiving}
            onClick={async () => {
              if (!archive) return;
              setArchiving(true);
              const saved = await setBusinessArchived(
                archive.id,
                !archive.archived,
                archive.archived ? "Business restored." : "Business archived.",
              );
              setArchiving(false);
              if (saved) setArchive(null);
            }}
          >
            {archive?.archived ? "Restore business" : "Archive business"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
export function BusinessForm({
  initial,
  onSaved,
}: {
  initial?: Business;
  onSaved?: (business: Business) => void;
}) {
  const { db, saveBusiness, uploadLogo, notify, backend } = useData();
  // Supabase keeps a file per upload. The browser-only demo stores the image
  // itself in local storage (about 5 MB in total) and copies it into every
  // issued snapshot, so it stays small there.
  const logoLimit =
    backend === "supabase"
      ? { bytes: LOGO_MAX_BYTES, label: "3 MB" }
      : { bytes: 300 * 1024, label: "300 KB" };
  const [form, setForm] = useState<Business>(() =>
    initial ? structuredClone(initial) : newBusiness(),
  );
  const [baseline, setBaseline] = useState(() => JSON.stringify(form));
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const dirty = JSON.stringify(form) !== baseline;
  useUnsavedChanges(dirty);
  const update = (key: keyof Business, value: string | number) =>
    setForm((f) => ({ ...f, [key]: value }));
  const text = (
    key: keyof Business,
    label: string,
    required = false,
    type = "text",
  ) => (
    <Field label={label}>
      <input
        type={type}
        required={required}
        value={String(form[key])}
        onChange={(e) => update(key, e.target.value)}
      />
    </Field>
  );
  async function upload(file?: File) {
    if (!file) return;
    if (
      !["image/png", "image/jpeg"].includes(file.type) ||
      file.size > logoLimit.bytes
    ) {
      notify(
        `Choose a PNG or JPEG logo smaller than ${logoLimit.label}.`,
        true,
      );
      return;
    }
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width > 2000 || bitmap.height > 2000) {
        bitmap.close();
        throw new Error(
          "Logo dimensions must be no more than 2,000 × 2,000 pixels.",
        );
      }
      bitmap.close();
      const url = await uploadLogo(form.id, file);
      if (url) update("logo", url);
    } catch (e) {
      notify((e as Error).message || "Unable to read this image.", true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      data-unsaved={dirty}
      onSubmit={async (e) => {
        e.preventDefault();
        if (saving) return;
        const problems = validateBusiness({ ...form, name: form.name.trim() });
        setErrors(problems);
        if (problems.length) return;
        setSaving(true);
        const saved = await saveBusiness(
          {
            ...form,
            name: form.name.trim(),
            // Archive status is managed from the business list, never by this form.
            archived:
              db?.businesses.find((b) => b.id === form.id)?.archived ?? false,
          },
          initial ? "Business profile saved." : "Client business added.",
        );
        setSaving(false);
        if (saved) {
          setBaseline(JSON.stringify(form));
          onSaved?.(saved);
        }
      }}
    >
      <div className="form-section">
        <h3>Business identity</h3>
        <p>
          This identity will appear on the business’s invoices and quotations.
        </p>
        <div className="logo-upload">
          <BusinessMark business={form} />
          <div>
            <label className="btn secondary">
              <Upload size={16} />
              {busy
                ? backend === "supabase"
                  ? "Uploading…"
                  : "Reading image…"
                : "Upload logo"}
              <input
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg"
                aria-label="Upload business logo"
                disabled={busy}
                onChange={(e) => void upload(e.target.files?.[0])}
              />
            </label>
            <small>PNG or JPEG · up to {logoLimit.label} · 2,000 px max</small>
          </div>
          {form.logo && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => update("logo", "")}
            >
              Remove
            </Button>
          )}
        </div>
        <div className="form-grid">
          {text("name", "Trading / company name", true)}
          {text("industry", "Industry")}
          {text("email", "Contact email", true, "email")}
          {text("phone", "Phone")}
          {text("registration", "Business Registration Number")}
          {text("vat", "VAT registration number")}
        </div>
        <Field label="Business address">
          <textarea
            required
            rows={3}
            value={form.address}
            onChange={(e) => update("address", e.target.value)}
          />
        </Field>
      </div>
      <div className="form-section">
        <h3>Banking details</h3>
        <p>Use the client business’s details, not Africonnect’s.</p>
        <div className="form-grid">
          {text("bank", "Bank name")}
          {text("accountName", "Account holder")}
          {text("accountNumber", "Account number")}
          {text("branch", "Branch code")}
        </div>
      </div>
      <div className="form-section">
        <h3>Document preferences</h3>
        <div className="form-grid">
          {text("invoicePrefix", "Invoice prefix")}
          {text("quotationPrefix", "Quotation prefix")}
          <p className="form-hint">
            Leave a prefix empty if this business numbers its documents without
            one (0001 instead of INV-0001). Each new document continues from the
            highest issued number used so far. Drafts do not reserve numbers.
          </p>
          <Field label="Quotation validity (days)">
            <input
              type="number"
              required
              min="0"
              max="365"
              value={form.validityDays}
              onChange={(e) => update("validityDays", Number(e.target.value))}
            />
          </Field>
          <Field
            label="Default VAT rate (%)"
            hint="Set to 0 for a business that does not charge VAT."
          >
            <input
              type="number"
              required
              min="0"
              max="100"
              step="0.01"
              value={form.taxRate}
              onChange={(e) => update("taxRate", Number(e.target.value))}
            />
          </Field>
          <Field label="Document accent colour">
            <div className="color-field">
              <input
                type="color"
                value={form.accent}
                onChange={(e) => update("accent", e.target.value)}
              />
              <span>{form.accent.toUpperCase()}</span>
            </div>
          </Field>
        </div>
        <Field label="Default document notes">
          <textarea
            rows={3}
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
          />
        </Field>
      </div>
      {errors.length > 0 && (
        <div className="form-error" role="alert">
          <strong>Please check these details</strong>
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="form-footer">
        <span className="muted">
          {dirty ? "You have unsaved changes" : "Profile details"}
        </span>
        <Button type="submit" disabled={busy || saving}>
          {saving ? "Saving…" : "Save business"}
        </Button>
      </div>
    </form>
  );
}
export function BusinessWorkspace() {
  const { businessId } = useParams<{ businessId: string }>();
  const { db } = useData();
  const b = db?.businesses.find((b) => b.id === businessId);
  if (!b || !db)
    return (
      <Empty
        title="Business not found"
        description="Return to client businesses to select a workspace."
      >
        <Link href="/businesses" className="btn primary">
          Client businesses
        </Link>
      </Empty>
    );
  return (
    <>
      <PageHeading
        eyebrow={b.industry.toUpperCase()}
        title={b.name}
        description="Manage this business’s customers, services and documents."
      >
        <Link href={`/businesses/${b.id}/settings`} className="btn secondary">
          <Settings2 size={17} />
          Business settings
        </Link>
        {!b.archived && <CreateDocument businessId={b.id} />}
      </PageHeading>
      {b.archived && (
        <div className="info-note">
          This business is archived. Historical documents remain available.
          Restore it from Client businesses to resume work.
        </div>
      )}
      <div className="business-overview card">
        <BusinessMark business={b} />
        <div className="workspace-shortcuts">
          <Link href={`/businesses/${b.id}/customers`}>
            <Users size={20} />
            <strong>
              {db.customers.filter((c) => c.businessId === b.id).length}{" "}
              customers
            </strong>
            <ArrowUpRight size={16} />
          </Link>
          <Link href={`/businesses/${b.id}/items`}>
            <Package size={20} />
            <strong>
              {
                db.items.filter((i) => i.businessId === b.id && !i.archived)
                  .length
              }{" "}
              items & services
            </strong>
            <ArrowUpRight size={16} />
          </Link>
        </div>
      </div>
      <DocumentList businessId={b.id} />
    </>
  );
}
export function BusinessSettings() {
  const { businessId } = useParams<{ businessId: string }>();
  const { db } = useData();
  const b = db?.businesses.find((b) => b.id === businessId);
  if (!b)
    return (
      <Empty
        title="Business not found"
        description="Choose an existing business."
      />
    );
  return (
    <>
      <Link className="back-link" href={`/businesses/${b.id}`}>
        <ArrowLeft size={16} />
        Business workspace
      </Link>
      <PageHeading
        title="Business settings"
        description="Update the identity and defaults used for new documents."
      />
      <div className="info-note">
        <Building2 size={20} />
        Issued documents retain their original details when this profile
        changes.
      </div>
      <div className="card settings-card">
        <BusinessForm key={`${b.id}-${b.archived}`} initial={b} />
      </div>
    </>
  );
}
