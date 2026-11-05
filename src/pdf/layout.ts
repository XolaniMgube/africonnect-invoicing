/** Pure layout helpers for the PDF template (kept free of react-pdf so they can be unit tested). */

export const DESCRIPTION_CHUNK = 600;

/**
 * Splits very long descriptions at paragraph or word boundaries so each table
 * row stays small enough to be kept together on one page. Short text is
 * returned unchanged as a single part.
 */
export function splitDescription(text: string, max = DESCRIPTION_CHUNK) {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  parts.push(rest);
  return parts;
}
