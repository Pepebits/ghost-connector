/**
 * Tag function for server-rendered HTML with escaping BY DEFAULT. The UI renders
 * titles and content coming from an LLM and from Ghost; escaping has to be
 * the default, not a reminder. Use raw() explicitly to insert HTML that is
 * already safe (e.g. the result of another html() call).
 */
export class RawHtml {
  constructor(readonly value: string) {}
}

export function raw(value: string): RawHtml {
  return new RawHtml(value);
}

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderValue(value: unknown): string {
  if (value === undefined || value === null || value === false) return '';
  if (value instanceof RawHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  return escapeHtml(value);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    out += renderValue(values[i]);
    out += strings[i + 1] ?? '';
  }
  return out;
}
