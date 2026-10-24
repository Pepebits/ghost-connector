/**
 * Live draft of the WriterAgent while a `plan` is running. In memory
 * only (not persisted: the final artifact is the source of truth); the UI
 * polls it to show the text almost in real time.
 */
export interface LiveDraft {
  jobId: string;
  markdown: string;
  updatedAt: number;
  done: boolean;
}

const drafts = new Map<string, LiveDraft>();

// Past this time since it finished, the live draft adds
// nothing (the post detail shows the saved plan).
const TTL_MS = 10 * 60_000;

export function setLiveDraft(postId: string, jobId: string, markdown: string): void {
  drafts.set(postId, { jobId, markdown, updatedAt: Date.now(), done: false });
}

export function finishLiveDraft(postId: string): void {
  const d = drafts.get(postId);
  if (d) d.done = true;
}

export function getLiveDraft(postId: string): LiveDraft | null {
  const d = drafts.get(postId);
  if (!d) return null;
  if (d.done && Date.now() - d.updatedAt > TTL_MS) {
    drafts.delete(postId);
    return null;
  }
  return d;
}

/**
 * Extracts the (possibly truncated) value of the string field `field` from a
 * still-incomplete JSON, e.g. `{"title":"X","markdown":"Hola\nmun` -> `Hola\nmun`.
 * Returns null if the field has not started yet.
 */
export function extractPartialStringField(partialJson: string, field: string): string | null {
  const m = new RegExp(`"${field}"\\s*:\\s*"`).exec(partialJson);
  if (!m) return null;
  let out = '';
  for (let i = m.index + m[0].length; i < partialJson.length; i++) {
    const ch = partialJson[i];
    if (ch === '"') return out;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = partialJson[i + 1];
    if (next === undefined) break;
    i++;
    if (next === 'n') out += '\n';
    else if (next === 't') out += '\t';
    else if (next === 'r') out += '\r';
    else if (next === 'u') {
      const hex = partialJson.slice(i + 1, i + 5);
      if (hex.length < 4) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 4;
    } else out += next; // \" \\ \/
  }
  return out;
}
