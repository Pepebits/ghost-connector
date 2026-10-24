// PENDIENTE: the marker's former name, still read in drafts and plans written before.
const PENDING_RE = /\[\[(?:PENDING|PENDIENTE):([^\]]*)\]\]/g;

/** The full markers as they appear in the text (to list or count them). */
export function findPendingMarkers(text: string): string[] {
  return [...text.matchAll(PENDING_RE)].map((m) => m[0]);
}

/** Only the question text inside each marker, trimmed. */
export function extractPendingQuestions(text: string): string[] {
  return [...text.matchAll(PENDING_RE)].map((m) => (m[1] ?? '').trim());
}

export function countPending(text: string): number {
  return findPendingMarkers(text).length;
}

/** Questions for the form: no duplicates nor empty or filler markers ("..."). */
export function uniquePendingQuestions(text: string): string[] {
  return [...new Set(extractPendingQuestions(text))].filter((q) => q.replace(/[.\s…]/g, '').length > 0);
}
