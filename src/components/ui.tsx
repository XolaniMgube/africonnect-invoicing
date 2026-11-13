"use client";
import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useRef,
  type ReactElement,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Search, X, FileText, ArrowRight } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import type { Business } from "@/domain/types";
export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button className={`btn ${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  const id = useId();
  function associate(nodes: React.ReactNode): React.ReactNode {
    return Children.map(nodes, (child) => {
      if (!isValidElement(child)) return child;
      const element = child as ReactElement<Record<string, unknown>>;
      if (["input", "select", "textarea"].includes(String(element.type)))
        return cloneElement(element, {
          id,
          "aria-describedby": hint ? `${id}-hint` : undefined,
        });
      return element.props.children
        ? cloneElement(element, {
            children: associate(element.props.children as React.ReactNode),
          })
        : element;
    });
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {associate(children)}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search-box">
      <Search size={17} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content
          className={`dialog ${wide ? "wide" : ""}`}
          onOpenAutoFocus={() => {
            opener.current = document.activeElement as HTMLElement;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (opener.current?.isConnected) opener.current.focus();
          }}
        >
          <div className="dialog-header">
            <div>
              <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description>
                {description || "Review the details below."}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              className="icon-btn"
              aria-label="Close dialog"
            >
              <X size={20} />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <FileText size={27} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Badge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`badge ${status}`}>
      <span />
      {label ?? status}
    </span>
  );
}
export function BusinessMark({
  business,
  small = false,
}: {
  business: Pick<Business, "name" | "accent" | "logo">;
  small?: boolean;
}) {
  return (
    <span
      className={`business-mark ${small ? "small" : ""}`}
      style={{ background: business.accent + "16", color: business.accent }}
    >
      {business.logo ? (
        <Image src={business.logo} alt="" width={64} height={64} unoptimized />
      ) : (
        business.name
          .split(" ")
          .slice(0, 2)
          .map((w) => w[0])
          .join("")
      )}
    </span>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}
export function TextLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link className="text-link" href={href}>
      {children}
      <ArrowRight size={16} />
    </Link>
  );
}
