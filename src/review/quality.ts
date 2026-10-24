import { marked } from 'marked';
import type { RunArtifact } from '../types.js';
import { findPendingMarkers } from '../util/pending.js';

/**
 * Quality checklist for a plan, without AI: cheap checks on what
 * the writer prompt and the SeoAgent already require, to see at a glance
 * what is missing before applying. Recomputed live while editing.
 */
export interface QualityInput {
  title: string;
  markdown: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  primaryKeyword?: string | null;
  hasImage: boolean;
}

export interface QualityCheck {
  id: string;
  ok: boolean;
  label: string;
  detail: string;
  /** i18n key of the detail (quality.details.<detailKey>) and its variables: the view translates it. */
  detailKey: string;
  vars: Record<string, string | number>;
}

export interface QualityReport {
  score: number;
  checks: QualityCheck[];
}

// Same ranges as the writer prompt (rule 8 and rule 7) and the SEO schema limits.
const WORDS = { min: 900, max: 1600 };
const H2 = { min: 3, max: 6 };
const META_TITLE_MAX = 60;
// The post title (H1): longer than this gets cut in shares, tabs and, when Google ignores the meta title, in results.
const TITLE_MAX = 70;
const META_DESC = { min: 70, max: 155 };

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function checkQuality(input: QualityInput): QualityReport {
  const tokens = marked.lexer(input.markdown, { gfm: true });
  const words = input.markdown.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(Boolean).length;
  const headings = tokens.filter((t): t is Extract<typeof t, { type: 'heading' }> => t.type === 'heading');
  const h2 = headings.filter((h) => h.depth === 2).length;
  const h1 = headings.filter((h) => h.depth === 1).length;
  const firstParagraph = tokens.find((t) => t.type === 'paragraph')?.raw ?? '';
  const pending = findPendingMarkers(input.markdown).length;
  const keyword = input.primaryKeyword ? normalize(input.primaryKeyword) : '';

  const checks: QualityCheck[] = [
    {
      id: 'length',
      ok: words >= WORDS.min && words <= WORDS.max,
      label: 'Length',
      detail: `${words} words (target ${WORDS.min}-${WORDS.max})`,
      detailKey: 'length',
      vars: { count: words, min: WORDS.min, max: WORDS.max },
    },
    {
      id: 'sections',
      ok: h2 >= H2.min && h2 <= H2.max && h1 === 0,
      label: 'Structure',
      detail: h1 > 0 ? `${h1} H1 in the body (the H1 is the title, use ##)` : `${h2} H2 sections (target ${H2.min}-${H2.max})`,
      detailKey: h1 > 0 ? 'sectionsH1' : 'sections',
      vars: h1 > 0 ? { count: h1 } : { count: h2, min: H2.min, max: H2.max },
    },
    {
      id: 'pending',
      ok: pending === 0,
      label: 'Pending',
      detail: pending === 0 ? 'No [[PENDING:]]' : `${pending} unresolved [[PENDING:]] (they block apply)`,
      detailKey: pending === 0 ? 'pendingNone' : 'pending',
      vars: { count: pending },
    },
    {
      id: 'title-length',
      ok: input.title.trim().length <= TITLE_MAX,
      label: 'Title length',
      detail: `${input.title.trim().length}/${TITLE_MAX} characters`,
      detailKey: 'titleLength',
      vars: { count: input.title.trim().length, max: TITLE_MAX },
    },
  ];

  if (keyword) {
    checks.push(
      {
        id: 'keyword-title',
        ok: normalize(input.title).includes(keyword),
        label: 'Keyword in title',
        detail: `"${input.primaryKeyword}"`,
        detailKey: 'keywordTitle',
        vars: { keyword: input.primaryKeyword ?? "" },
      },
      {
        id: 'keyword-intro',
        ok: normalize(firstParagraph).includes(keyword),
        label: 'Keyword in intro',
        detail: `"${input.primaryKeyword}" in the first paragraph`,
        detailKey: 'keywordIntro',
        vars: { keyword: input.primaryKeyword ?? "" },
      },
    );
  }
  if (input.metaTitle !== undefined) {
    const n = (input.metaTitle ?? '').length;
    checks.push({ id: 'meta-title', ok: n > 0 && n <= META_TITLE_MAX, label: 'Meta title', detail: `${n}/${META_TITLE_MAX} characters`, detailKey: 'metaTitle', vars: { count: n, max: META_TITLE_MAX } });
  }
  if (input.metaDescription !== undefined) {
    const n = (input.metaDescription ?? '').length;
    checks.push({
      id: 'meta-description',
      ok: n >= META_DESC.min && n <= META_DESC.max,
      label: 'Meta description',
      detail: `${n} characters (target ${META_DESC.min}-${META_DESC.max})`,
      detailKey: 'metaDescription',
      vars: { count: n, min: META_DESC.min, max: META_DESC.max },
    });
  }
  checks.push({ id: 'image', ok: input.hasImage, label: 'Feature image', detail: input.hasImage ? 'Has one (or one is planned)' : 'No feature image', detailKey: input.hasImage ? 'imageYes' : 'imageNo', vars: {} });

  const score = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
  return { score, checks };
}

export function qualityInputFromPlan(plan: RunArtifact): QualityInput {
  return {
    title: plan.patch.title ?? plan.writer?.title ?? plan.snapshot.title,
    markdown: plan.writer?.markdown ?? '',
    metaTitle: plan.seo?.meta_title,
    metaDescription: plan.seo?.meta_description,
    primaryKeyword: plan.seo?.primary_keyword,
    hasImage: !!(plan.snapshot.feature_image || plan.uploadedImage || plan.imagePlan),
  };
}
