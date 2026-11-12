import type { Business, DocumentTemplate } from "./types";

/**
 * Document templates change only how invoices and quotations look. Every
 * template shows the same data and totals. The chosen template is part of the
 * business profile, so it is copied into each issued document's snapshot:
 * an issued document keeps the look it was issued with.
 */
export const DOCUMENT_TEMPLATES: {
  id: DocumentTemplate;
  name: string;
  description: string;
}[] = [
  {
    id: "classic",
    name: "Classic",
    description:
      "Business details in the heading, a light table and an accent-coloured total.",
  },
  {
    id: "executive",
    name: "Executive",
    description:
      "Two colours, rounded table header and total, payment card, contact footer and signature.",
  },
];

/** Defaults for businesses and snapshots saved before templates existed. */
export const DESIGN_DEFAULTS = {
  template: "classic" as DocumentTemplate,
  secondaryAccent: "#C9A45C",
  signatoryName: "",
  signatoryTitle: "",
  closingMessage: "Thank you for your service!",
};

export const templateOf = (b: Pick<Business, "template">): DocumentTemplate =>
  DOCUMENT_TEMPLATES.some((t) => t.id === b.template) ? b.template : "classic";

/** Fills design fields missing from older records, keeping everything else. */
export function withDesignDefaults<T extends Partial<Business>>(
  b: T,
): T & typeof DESIGN_DEFAULTS {
  return {
    ...b,
    template: b.template ? templateOf({ template: b.template }) : "classic",
    secondaryAccent: /^#[a-f\d]{6}$/i.test(b.secondaryAccent ?? "")
      ? b.secondaryAccent!
      : DESIGN_DEFAULTS.secondaryAccent,
    signatoryName: b.signatoryName ?? "",
    signatoryTitle: b.signatoryTitle ?? "",
    closingMessage: b.closingMessage ?? DESIGN_DEFAULTS.closingMessage,
  };
}
