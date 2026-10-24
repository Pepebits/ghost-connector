/**
 * First letter of an AI-written title in uppercase ("cambio de..." ->
 * "Cambio de..."), after any opening punctuation ("¿", "¡", quotes).
 * Brand-style words with an inner capital ("iPhone", "eBay") are left alone.
 */
export function capitalizeTitle(title: string): string {
  const m = /^([\s¿¡"'«“‘(]*)(\p{Ll})(\S*)/u.exec(title);
  if (!m) return title;
  const [, lead, first, rest] = m;
  if (/\p{Lu}/u.test(rest!)) return title;
  return `${lead}${first!.toUpperCase()}${title.slice(lead!.length + 1)}`;
}
