"use client";
import { useState } from "react";
import { Field } from "@/components/ui";
import { cents } from "@/domain/documents";
import { units, type LineItem } from "@/domain/types";

const parse = (value: string) => (value === "" ? NaN : Number(value));
/** Shown in a price input: whole cents, without trailing zeros. */
const shown = (value: number) =>
  Number.isFinite(value) ? String(cents(value) / 100) : "";

/**
 * Quantity, unit, unit price and item total of one document line. Either
 * price field can be typed in: a unit price gives the item total (quantity ×
 * unit price); an item total gives the unit price (item total ÷ quantity).
 * Whichever was typed last stays fixed when the quantity changes.
 *
 * Only the quantity and unit price are stored. A unit price worked out from a
 * total is kept unrounded (R100 ÷ 3 = R33.333…), so the line still adds up to
 * exactly the total that was typed.
 */
export function LineAmounts({
  line,
  onChange,
}: {
  line: LineItem;
  onChange: (partial: Partial<LineItem>) => void;
}) {
  // The item total the employee typed, in cents, while it is the fixed one.
  const [fixedTotal, setFixedTotal] = useState<number | null>(null);
  // Exactly what is being typed, so "12." or "0.0" are not reformatted mid-way.
  const [draft, setDraft] = useState<{
    field: "price" | "total";
    value: string;
  } | null>(null);

  const total =
    fixedTotal !== null
      ? fixedTotal / 100
      : Number.isFinite(line.quantity) && Number.isFinite(line.price)
        ? cents(line.quantity * line.price) / 100
        : NaN;
  const priceFor = (totalCents: number, quantity: number) =>
    quantity > 0 ? totalCents / 100 / quantity : line.price;

  return (
    <div className="line-numbers">
      <Field label="Quantity">
        <input
          type="number"
          min="0.001"
          max="10000000"
          step="any"
          value={Number.isNaN(line.quantity) ? "" : line.quantity}
          onChange={(e) => {
            const quantity = parse(e.target.value);
            onChange(
              fixedTotal !== null && quantity > 0
                ? { quantity, price: priceFor(fixedTotal, quantity) }
                : { quantity },
            );
          }}
        />
      </Field>
      <Field label="Unit">
        <select
          value={line.unit}
          onChange={(e) => onChange({ unit: e.target.value })}
        >
          {units.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </Field>
      <Field label="Unit price (R)">
        <input
          type="number"
          min="0"
          max="1000000000"
          step="0.01"
          value={draft?.field === "price" ? draft.value : shown(line.price)}
          onChange={(e) => {
            setDraft({ field: "price", value: e.target.value });
            setFixedTotal(null);
            onChange({ price: parse(e.target.value) });
          }}
          onBlur={() => setDraft(null)}
        />
      </Field>
      <Field label="Item total (R)">
        <input
          type="number"
          min="0"
          max="1000000000"
          step="0.01"
          value={draft?.field === "total" ? draft.value : shown(total)}
          onChange={(e) => {
            setDraft({ field: "total", value: e.target.value });
            const typed = parse(e.target.value);
            if (!Number.isFinite(typed)) {
              setFixedTotal(null);
              onChange({ price: NaN });
              return;
            }
            setFixedTotal(cents(typed));
            onChange({ price: priceFor(cents(typed), line.quantity) });
          }}
          onBlur={() => setDraft(null)}
        />
      </Field>
    </div>
  );
}
