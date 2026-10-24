import type { ReviewCategoryStats } from '../db/repo.js';
import { t } from '../i18n/index.js';

/**
 * Suggestions for the writer prompt based on what the editor
 * rejects in block review. Only suggested with enough evidence:
 * at least MIN_CASES decisions in that category and a rejection rate
 * >= REJECT_RATIO. The rule is never applied automatically: the UI proposes it and the editor
 * decides whether to add it to the prompt (with a saved revision, like any edit).
 */
export const MIN_CASES = 5;
export const REJECT_RATIO = 0.6;

// Suggested rule per action and block type (most specific wins). Written in
// Spanish on purpose: it is appended to the writer prompt, which is in Spanish.
const RULES: Record<string, string> = {
  'modified:intro': 'Conserva la entradilla del autor: corrige errores, pero no la reescribas.',
  'modified:heading': 'No cambies los encabezados del autor salvo errores de ortografia.',
  'modified:code': 'No modifiques los bloques de codigo del autor salvo un bug evidente, y explicalo en `changes_made`.',
  'removed:code': 'Nunca elimines bloques de codigo del autor.',
  'modified:paragraph': 'Se conservador con los parrafos del autor: corrige y aclara, pero no los reescribas enteros.',
  'added:heading': 'No añadas secciones nuevas si no se piden: amplia las que ya existen.',
  'added:paragraph': 'No añadas parrafos de relleno: amplia solo donde el texto lo necesite.',
  added: 'Añade menos contenido nuevo: amplia lo existente antes que crear bloques nuevos.',
  removed: 'No elimines contenido del autor; si crees que sobra, proponlo en `changes_made`.',
  modified: 'Haz cambios mas conservadores sobre el texto del autor.',
};

export interface PromptSuggestion {
  category: string;
  description: string;
  total: number;
  rejected: number;
  rule: string;
}

/** "changes to the intro", in the UI language (prompts.categories.*). */
export function describeCategory(category: string): string {
  const [action = '', kind = 'other'] = category.split(':');
  const kindKey = `prompts.categories.kinds.${kind}`;
  const kindText = t(kindKey) === kindKey ? kind : t(kindKey);
  const actionKey = `prompts.categories.actions.${action}`;
  const out = t(actionKey, { kind: kindText });
  return out === actionKey ? `${action} ${kindText}` : out;
}

export function promptSuggestions(stats: ReviewCategoryStats[]): PromptSuggestion[] {
  return stats
    .filter((s) => s.total >= MIN_CASES && s.rejected / s.total >= REJECT_RATIO)
    .map((s) => ({
      category: s.category,
      description: describeCategory(s.category),
      total: s.total,
      rejected: s.rejected,
      rule: RULES[s.category] ?? RULES[s.category.split(':')[0] ?? ''] ?? 'Haz cambios mas conservadores sobre el texto del autor.',
    }))
    .sort((a, b) => b.rejected / b.total - a.rejected / a.total);
}
