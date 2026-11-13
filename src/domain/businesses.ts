import type { Business } from "./types";
import { DOCUMENT_TEMPLATES } from "./templates";
import { isEmail } from "../../supabase/functions/_shared/invoice-email";

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
  if (!/^#[a-f\d]{6}$/i.test(business.accent))
    errors.push("Choose a valid document accent colour.");
  if (business.emailFrom.trim() && !isEmail(business.emailFrom))
    errors.push(
      "“Send invoices from” must be an email address, e.g. info@yourdomain.co.za.",
    );
  if (!DOCUMENT_TEMPLATES.some((t) => t.id === business.template))
    errors.push("Choose a document template.");
  if (!/^#[a-f\d]{6}$/i.test(business.secondaryAccent))
    errors.push("Choose a valid second document colour.");
  if (business.closingMessage.length > 80)
    errors.push("Keep the closing message to 80 characters or fewer.");
  for (const [label, value] of [
    ["Signatory name", business.signatoryName],
    ["Signatory title", business.signatoryTitle],
  ])
    if (value.length > 60) errors.push(`${label}: use 60 characters or fewer.`);
  return errors;
}
