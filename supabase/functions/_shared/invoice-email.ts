/**
 * Invoice emails: recipient checks, default wording and the email body.
 * Plain TypeScript with no imports, shared by the app (default wording,
 * validation before sending), the tests and the `send-invoice` Edge Function.
 */

export type SendRequest = {
  documentId: string;
  to: string[];
  cc: string[];
  subject: string;
  message: string;
};

export const MAX_RECIPIENTS = 10;
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;

export const isEmail = (value: string) => EMAIL.test(value.trim());

/** "a@x.co.za, b@y.com; c@z.com" → unique, trimmed addresses. */
export function parseRecipients(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const email = part.trim();
    if (email && !seen.has(email.toLowerCase())) {
      seen.add(email.toLowerCase());
      out.push(email);
    }
  }
  return out;
}

export function validateSendRequest(request: SendRequest): string[] {
  const errors: string[] = [];
  if (!request.to.length) errors.push("Add at least one recipient.");
  const all = [...request.to, ...request.cc];
  const bad = all.filter((e) => !isEmail(e));
  if (bad.length)
    errors.push(`Check these email addresses: ${bad.join(", ")}.`);
  if (all.length > MAX_RECIPIENTS)
    errors.push(`Send to at most ${MAX_RECIPIENTS} addresses at a time.`);
  if (!request.subject.trim()) errors.push("Add a subject.");
  if (request.subject.length > 200)
    errors.push("Keep the subject to 200 characters or fewer.");
  if (request.message.length > 5000)
    errors.push("Keep the message to 5,000 characters or fewer.");
  return errors;
}

export const rand = (value: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(
    value,
  );

export function defaultSubject(number: string, businessName: string) {
  return `Invoice ${number} from ${businessName}`;
}

export function defaultMessage(details: {
  number: string;
  customerName: string;
  contact: string;
  businessName: string;
  total: number;
  balance: number;
}) {
  const owing =
    details.balance < details.total
      ? `${rand(details.total)}, of which ${rand(details.balance)} is still due`
      : rand(details.total);
  return `Good day ${details.contact || details.customerName},

Please find attached invoice ${details.number} for ${owing}.

Kind regards,
${details.businessName}`;
}

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** HTML and plain-text bodies: the message, then a short invoice summary. */
export function emailBody(details: {
  message: string;
  number: string;
  businessName: string;
  balance: number;
  dueDate: string;
}) {
  const summary = `Invoice ${details.number} · Balance due ${rand(details.balance)} · Due ${details.dueDate}`;
  const paragraphs = details.message
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  const html = `<!doctype html>
<html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2a3c">
${paragraphs}
<p style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:12px;color:#5f6878">${escapeHtml(summary)}<br>The invoice is attached as a PDF.</p>
</body></html>`;
  const text = `${details.message.trim()}\n\n—\n${summary}\nThe invoice is attached as a PDF.`;
  return { html, text };
}

/** Attachment name, e.g. "Invoice-INV-0001.pdf". */
export const pdfName = (number: string) =>
  `Invoice-${number.replace(/[^\w.-]+/g, "-")}.pdf`;
