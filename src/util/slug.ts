/** "Cabezal termostático blanco" -> "cabezal-termostatico-blanco". Cuts at a whole word, never midway. */
export function slugify(text: string, maxLength = 60): string {
  const words = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strips accents/diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let result = '';
  for (const word of words) {
    const candidate = result ? `${result}-${word}` : word;
    if (candidate.length > maxLength) break;
    result = candidate;
  }
  return result || 'imagen';
}
