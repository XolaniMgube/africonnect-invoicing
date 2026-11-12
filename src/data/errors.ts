/**
 * Plain-language messages for Supabase failures. Messages raised by the
 * database's own rules (see the migration's `raise exception` lines) are
 * already written for employees and pass through unchanged.
 */
type Failure = {
  code?: string;
  message?: string;
  status?: number;
  name?: string;
};

export const OFFLINE =
  "Couldn’t reach the database. Check your internet connection and try again. Nothing was saved.";

const offline = (e: Failure) =>
  e.name === "AuthRetryableFetchError" ||
  /failed to fetch|networkerror|fetch failed|load failed|network request failed/i.test(
    e.message ?? "",
  );

export function databaseMessage(error: Failure): string {
  if (offline(error)) return OFFLINE;
  if (
    (error.code === "PGRST204" || error.code === "42703") &&
    /discount_amount/.test(error.message ?? "")
  )
    return "Document discounts are not enabled in the database yet. Ask an administrator to apply the document-discounts update, then save again. Nothing was saved.";
  if (
    (error.code === "PGRST204" || error.code === "42703") &&
    /revision_of_id/.test(error.message ?? "")
  )
    return "Document revisions are not enabled in the database yet. Ask an administrator to apply the document-revisions update. Nothing was saved.";
  if (
    (error.code === "PGRST204" || error.code === "42703") &&
    /template|secondary_accent|signatory_|closing_message/.test(
      error.message ?? "",
    )
  )
    return "Document templates are not enabled in the database yet. Ask an administrator to apply the document-templates update, then save again. Nothing was saved.";
  switch (error.code) {
    case "P0001": // raised by a database rule
      return error.message || "The database rejected this change.";
    case "42501": // row-level security or missing privilege
      return "Your account isn’t allowed to make this change. Ask an administrator to add you as an employee.";
    case "PGRST301":
    case "PGRST303":
      return "Your session has expired. Sign in again to continue.";
    case "PGRST116": // .single() found no row
      return "This record is no longer available. Refresh the page and try again.";
    case "23505":
      return /documents_number_unique/.test(error.message ?? "")
        ? "This number is already used by another document of this business. Choose a different number."
        : "This conflicts with a record another employee just saved. Refresh the page and try again.";
    case "23503":
      return "A related record is missing. Refresh the page and try again.";
    case "23514":
      return "The database rejected these details. Check the form and try again.";
  }
  return `The database could not complete this change. Try again.${error.message ? ` (${error.message})` : ""}`;
}

export function signInMessage(error: Failure): string {
  if (offline(error))
    return "Couldn’t reach the sign-in service. Check your internet connection and try again.";
  switch (error.code) {
    case "invalid_credentials":
      return "Email or password is incorrect.";
    case "email_not_confirmed":
      return "This email address hasn’t been confirmed yet. Ask an administrator to confirm it.";
    case "user_banned":
      return "This account has been disabled. Ask an administrator for help.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Too many sign-in attempts. Wait a minute and try again.";
  }
  if (error.status === 429)
    return "Too many sign-in attempts. Wait a minute and try again.";
  return error.message || "Sign-in failed. Try again.";
}

/** Largest logo the app accepts with Supabase; the bucket limit must match. */
export const LOGO_MAX_BYTES = 3 * 1024 * 1024;

export function storageMessage(
  error: Failure & { statusCode?: string },
  fileSize?: number,
): string {
  if (offline(error))
    return "Couldn’t upload the logo. Check your internet connection and try again.";
  if (error.statusCode === "413" || /size/i.test(error.message ?? ""))
    return fileSize !== undefined && fileSize <= LOGO_MAX_BYTES
      ? "Logo storage refused this file as too large, although it is under the app’s 3 MB limit. The storage limit hasn’t been raised yet: ask an administrator to apply the larger-logo update in Supabase."
      : "This logo is too large. Choose a PNG or JPEG smaller than 3 MB.";
  if (error.statusCode === "415" || /mime/i.test(error.message ?? ""))
    return "Choose a PNG or JPEG logo.";
  if (
    error.statusCode === "403" ||
    /row-level security|unauthori/i.test(error.message ?? "")
  )
    return "Your account isn’t allowed to upload logos. Ask an administrator to add you as an employee.";
  return `The logo could not be uploaded. Try again.${error.message ? ` (${error.message})` : ""}`;
}
