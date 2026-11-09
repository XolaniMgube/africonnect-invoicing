"use client";
import { useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Customer } from "@/domain/types";

/**
 * The customer field of the document editor: a dropdown of the business's
 * customers that can also be typed into to search them (name, contact
 * person, email or phone). Follows the WAI-ARIA combobox pattern, so it works
 * with the keyboard (↑ ↓ Enter Esc) and screen readers.
 */
export function CustomerPicker({
  customers,
  value,
  onChange,
  label = "Customer",
}: {
  customers: Customer[];
  value: string;
  onChange: (customerId: string) => void;
  label?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const selected = customers.find((c) => c.id === value);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = customers.filter((c) => {
    const text = [c.name, c.contact, c.email, c.phone].join(" ").toLowerCase();
    return terms.every((t) => text.includes(t));
  });
  const highlighted = Math.min(active, Math.max(matches.length - 1, 0));
  const optionId = (i: number) => `${id}-option-${i}`;

  function show() {
    if (open) return;
    setQuery("");
    setActive(
      Math.max(
        customers.findIndex((c) => c.id === value),
        0,
      ),
    );
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setQuery("");
  }
  function choose(customer: Customer) {
    onChange(customer.id);
    close();
  }
  function move(to: number) {
    const next = Math.max(0, Math.min(to, matches.length - 1));
    setActive(next);
    list.current
      ?.querySelector(`#${CSS.escape(optionId(next))}`)
      ?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div className="field customer-picker">
      <label htmlFor={`${id}-input`}>{label}</label>
      <div className="picker-control">
        <input
          ref={input}
          id={`${id}-input`}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={
            open && matches.length ? optionId(highlighted) : undefined
          }
          autoComplete="off"
          // Closed: the chosen customer. Open: what is being searched for.
          value={open ? query : (selected?.name ?? "")}
          placeholder={
            open && selected
              ? selected.name
              : customers.length
                ? "Select or search a customer"
                : "No customers yet"
          }
          onFocus={show}
          onClick={show}
          onBlur={close}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!open) return show();
              move(highlighted + (e.key === "ArrowDown" ? 1 : -1));
            } else if (e.key === "Enter" && open) {
              e.preventDefault();
              if (matches[highlighted]) choose(matches[highlighted]);
            } else if (e.key === "Escape" && open) {
              e.preventDefault();
              close();
            }
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          className="picker-toggle"
          aria-label={open ? "Close customer list" : "Open customer list"}
          // Keep focus in the input so the list does not close and reopen.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (open) close();
            else input.current?.focus();
          }}
        >
          <ChevronDown size={17} />
        </button>
        {open && (
          <ul
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label={`${label} options`}
            className="picker-list"
          >
            {matches.map((c, i) => (
              <li
                key={c.id}
                id={optionId(i)}
                role="option"
                aria-selected={c.id === value}
                className={i === highlighted ? "highlighted" : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => i !== highlighted && setActive(i)}
                onClick={() => choose(c)}
              >
                <strong>{c.name}</strong>
                {(c.email || c.phone) && (
                  <small>
                    {[c.email, c.phone].filter(Boolean).join(" · ")}
                  </small>
                )}
              </li>
            ))}
            {!matches.length && (
              <li className="picker-empty" role="presentation">
                {customers.length
                  ? `No customers match “${query.trim()}”.`
                  : "This business has no customers yet."}
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
