"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import {
  LayoutDashboard,
  Building2,
  FileText,
  CircleHelp,
  LogOut,
  ChevronRight,
  Menu,
  Users,
  Package,
  Settings2,
  ChevronsUpDown,
  LayoutTemplate,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { hasVisibleUnsavedChanges } from "./unsaved";
import { useData } from "./provider";
import { Modal, SearchBox, BusinessMark, Button } from "./ui";
export function Brand() {
  return (
    <div className="brand">
      <Image
        src="/africonnect-logo.png"
        alt=""
        width={42}
        height={48}
        unoptimized
      />
      <div>
        <strong>
          <span>AFRI</span>CONNECT
        </strong>
        <small>INVOICING</small>
      </div>
    </div>
  );
}
type Crumb = { label: string; href?: string };
function NavLink({
  href,
  active,
  onNavigate,
  children,
}: {
  href: string;
  active: boolean;
  onNavigate: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      className={`nav-link ${active ? "active" : ""}`}
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
    >
      {children}
    </Link>
  );
}
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const { db, error, retry, notify, authReady, employee, signOut, backend } =
    useData();
  const [mobile, setMobile] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const [search, setSearch] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    if (authReady && !employee) router.replace("/login");
  }, [authReady, employee, router]);
  const local = backend === "local";
  const initials =
    employee?.name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "AC";
  const businessId = path.startsWith("/businesses/")
    ? path.split("/")[2]
    : path.startsWith("/documents/")
      ? db?.documents.find((d) => d.id === path.split("/")[2])?.businessId
      : undefined;
  const business = db?.businesses.find((b) => b.id === businessId);
  const openDoc = path.startsWith("/documents/")
    ? db?.documents.find((d) => d.id === path.split("/")[2])
    : undefined;
  const close = () => setMobile(false);
  const section = path.split("/")[3];
  const crumbs: Crumb[] = [{ label: "Workspace", href: "/overview" }];
  if (path === "/overview") crumbs.push({ label: "Overview" });
  else if (path === "/templates") crumbs.push({ label: "Templates" });
  else if (path === "/admin") crumbs.push({ label: "Users & access" });
  else if (path === "/receivables") crumbs.push({ label: "Receivables" });
  else if (path === "/help")
    crumbs.push({ label: local ? "Help & demo guide" : "Help" });
  else if (path.startsWith("/businesses") || openDoc) {
    crumbs.push({ label: "Client businesses", href: "/businesses" });
    if (business) {
      crumbs.push({ label: business.name, href: `/businesses/${business.id}` });
      if (openDoc)
        crumbs.push({
          label: `${openDoc.kind === "invoice" ? "Invoice" : "Quotation"} ${openDoc.number}`,
        });
      else if (section === "customers") crumbs.push({ label: "Customers" });
      else if (section === "items") crumbs.push({ label: "Items & services" });
      else if (section === "settings")
        crumbs.push({ label: "Business settings" });
      else if (section === "documents")
        crumbs.push({
          label: `New ${params.get("kind") === "quotation" ? "quotation" : "invoice"}`,
        });
    }
  }
  const nav = (
    <>
      <div className="sidebar-top">
        <Link
          href="/overview"
          onClick={close}
          aria-label="Africonnect Invoicing overview"
        >
          <Brand />
        </Link>
        <span className="workspace-label">EMPLOYEE WORKSPACE</span>
      </div>
      <nav aria-label="Main navigation">
        <NavLink
          href="/overview"
          active={path === "/overview"}
          onNavigate={close}
        >
          <LayoutDashboard size={19} />
          <span>Overview</span>
        </NavLink>
        <NavLink
          href="/businesses"
          active={path === "/businesses"}
          onNavigate={close}
        >
          <Building2 size={19} />
          <span>Client businesses</span>
          <span className="nav-count">
            {db?.businesses.filter((b) => !b.archived).length || 0}
          </span>
        </NavLink>
        {db?.businesses.some((b) => b.isSuper) && (
          <NavLink
            href="/receivables"
            active={path === "/receivables"}
            onNavigate={close}
          >
            <Wallet size={19} />
            <span>Receivables</span>
          </NavLink>
        )}
        <NavLink
          href="/templates"
          active={path === "/templates"}
          onNavigate={close}
        >
          <LayoutTemplate size={19} />
          <span>Templates</span>
        </NavLink>
        {employee?.role === "admin" && (
          <NavLink href="/admin" active={path === "/admin"} onNavigate={close}>
            <ShieldCheck size={19} />
            <span>Users & access</span>
          </NavLink>
        )}
        {business && (
          <>
            <div className="nav-section">
              BUSINESS WORKSPACE
              <span>{business.name}</span>
            </div>
            <NavLink
              href={`/businesses/${business.id}`}
              active={
                !!openDoc || section === undefined || section === "documents"
              }
              onNavigate={close}
            >
              <FileText size={18} />
              <span>Documents</span>
            </NavLink>
            <NavLink
              href={`/businesses/${business.id}/customers`}
              active={section === "customers"}
              onNavigate={close}
            >
              <Users size={18} />
              <span>Customers</span>
            </NavLink>
            <NavLink
              href={`/businesses/${business.id}/items`}
              active={section === "items"}
              onNavigate={close}
            >
              <Package size={18} />
              <span>Items & services</span>
            </NavLink>
            <NavLink
              href={`/businesses/${business.id}/settings`}
              active={section === "settings"}
              onNavigate={close}
            >
              <Settings2 size={18} />
              <span>Business settings</span>
            </NavLink>
          </>
        )}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note">
          <span className="tiny-dot" /> A connected way to work.
          <p>One workspace. Every client business.</p>
        </div>
        <NavLink href="/help" active={path === "/help"} onNavigate={close}>
          <CircleHelp size={19} />
          <span>{local ? "Help & demo guide" : "Help"}</span>
        </NavLink>
        <div className="employee">
          <span className="avatar">{initials}</span>
          <div>
            <strong>{employee?.name}</strong>
            <small>Africonnect Solutions</small>
          </div>
          <button
            className="icon-btn"
            aria-label="Log out"
            disabled={signingOut}
            onClick={async () => {
              if (
                hasVisibleUnsavedChanges() &&
                !confirm("Discard unsaved changes and log out?")
              )
                return;
              setSigningOut(true);
              try {
                await signOut();
                router.replace("/login");
              } catch {
                notify(
                  "Unable to end the session. Please allow session storage and retry.",
                  true,
                );
              } finally {
                setSigningOut(false);
              }
            }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </>
  );
  if (!employee)
    return <div className="loading">Opening employee workspace…</div>;
  return (
    <div className="app-shell">
      <aside className="sidebar">{nav}</aside>
      <Modal
        open={mobile}
        onOpenChange={setMobile}
        title="Navigation"
        description="Africonnect employee workspace"
      >
        <div className="mobile-nav">{nav}</div>
      </Modal>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-btn mobile-toggle"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={22} />
            </button>
            <nav aria-label="Breadcrumb" className="breadcrumb">
              {crumbs.map((crumb, i) =>
                i < crumbs.length - 1 ? (
                  <Fragment key={crumb.label + i}>
                    <Link href={crumb.href!}>{crumb.label}</Link>
                    <ChevronRight size={14} aria-hidden="true" />
                  </Fragment>
                ) : (
                  <span key={crumb.label + i} aria-current="page">
                    {crumb.label}
                  </span>
                ),
              )}
            </nav>
          </div>
          <div className="topbar-right">
            {local && (
              <span className="demo-pill">
                <span /> Demo workspace
              </span>
            )}
            <span className="avatar small" title={employee.email}>
              {initials}
            </span>
          </div>
        </header>
        {business && (
          <div className="context-bar">
            <BusinessMark business={business} small />
            <span>
              Working on: <strong>{business.name}</strong>
              {business.archived && " · Archived"}
            </span>
            <button className="btn ghost" onClick={() => setSwitcher(true)}>
              Switch business <ChevronsUpDown size={15} />
            </button>
          </div>
        )}
        <main className="main-content">
          {error ? (
            <div className="card empty">
              <h2>We couldn’t open your records</h2>
              <p role="alert">{error}</p>
              <Button onClick={retry}>Retry loading</Button>
            </div>
          ) : db ? (
            children
          ) : (
            <div className="loading">Loading your workspace…</div>
          )}
        </main>
        <footer className="app-footer">
          <span>© 2026 Africonnect Solutions</span>
          <span>
            {local ? "Demo data · Saved in this browser" : "Shared workspace"}
          </span>
        </footer>
      </div>
      <Modal
        open={switcher}
        onOpenChange={setSwitcher}
        title="Switch client business"
        description="Open the customers, items and documents belonging to a business."
      >
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Find a client business…"
        />
        <div className="selection-list">
          {db?.businesses
            .filter(
              (b) =>
                !b.archived &&
                b.name.toLowerCase().includes(search.toLowerCase()),
            )
            .map((b) => (
              <Link
                key={b.id}
                href={`/businesses/${b.id}`}
                onClick={() => setSwitcher(false)}
              >
                <BusinessMark business={b} small />
                <span>{b.name}</span>
                <ChevronRight size={17} />
              </Link>
            ))}
        </div>
      </Modal>
    </div>
  );
}
