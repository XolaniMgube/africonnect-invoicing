import type { Business } from "./types";

/** Empty (plain numbers such as 0001) or 1–12 letters, numbers and hyphens. */
const PREFIX = /^([A-Za-z0-9][A-Za-z0-9-]{0,11})?$/;

/** Business-profile rules shared by the settings form and the repository. */
export function validateBusiness(business: Business): string[] {
  const errors: string[] = [];
  if (!business.name.trim()) errors.push("Enter the trading / company name.");
  if (!business.email.trim()) errors.push("Enter a contact email.");
  if (!business.address.trim()) errors.push("Enter the business address.");
  for (const [label, prefix] of [
    ["Invoice prefix", business.invoicePrefix],
    ["Quotation prefix", business.quotationPrefix],
  ])
    if (!PREFIX.test(prefix))
      errors.push(
        `${label}: leave it empty, or use 1–12 letters, numbers or hyphens (for example GZ-INV).`,
      );
  if (
    business.invoicePrefix &&
    business.invoicePrefix.trim().toUpperCase() ===
      business.quotationPrefix.trim().toUpperCase()
  )
    errors.push("Use different invoice and quotation prefixes.");
  for (const [label, days] of [
    ["Default payment period", business.paymentDays],
    ["Quotation validity", business.validityDays],
  ] as const)
    if (!Number.isInteger(days) || days < 0 || days > 365)
      errors.push(`${label} must be a whole number of days from 0 to 365.`);
  if (
    !Number.isFinite(business.taxRate) ||
    business.taxRate < 0 ||
    business.taxRate > 100
  )
    errors.push("Default VAT rate must be between 0 and 100.");
  else if (business.taxRate > 0 && !business.vat.trim())
    errors.push(
      "Add the VAT registration number, or set the default VAT rate to 0 for a business that does not charge VAT.",
    );
  if (!/^#[a-f\d]{6}$/i.test(business.accent))
    errors.push("Choose a valid document accent colour.");
  return errors;
}
