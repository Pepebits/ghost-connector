import { z } from 'zod';

export const WriterOutputSchema = z.object({
  title: z.string().min(10).max(120),
  markdown: z.string().min(200),
  outline: z.array(z.string()),
  summary: z.string().max(400),
  language: z.enum(['es', 'en']),
  changes_made: z.array(z.string()),
  confidence: z.enum(['low', 'medium', 'high']),
});
export type WriterOutput = z.infer<typeof WriterOutputSchema>;

export const ResolveOutputSchema = z.object({
  markdown: z.string().min(200),
  changes_made: z.array(z.string()),
  // [[PENDING:]] markers (exact text) still unanswered and left as is.
  unresolved: z.array(z.string()),
});
export type ResolveOutput = z.infer<typeof ResolveOutputSchema>;

export const FixOutputSchema = z.object({
  title: z.string().min(1).max(200),
  markdown: z.string().min(200),
  meta_title: z.string().max(60),
  meta_description: z.string().max(155),
  changes_made: z.array(z.string()),
});
export type FixOutput = z.infer<typeof FixOutputSchema>;

export const IdeasOutputSchema = z.object({
  ideas: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        // Brief for "New post": what it covers, in a sentence or two.
        topic: z.string().min(1).max(600),
        why: z.string().min(1).max(400),
        // Exact titles of the blog's posts it builds on ([] if none).
        related: z.array(z.string()).max(5),
        // The Search Console query it answers, or "".
        query: z.string().max(200),
      }),
    )
    .min(1)
    .max(12),
});
export type IdeasOutput = z.infer<typeof IdeasOutputSchema>;

export const SnippetOutputSchema = z.object({
  options: z
    .array(
      z.object({
        meta_title: z.string().min(1).max(70),
        meta_description: z.string().min(1).max(200),
        angle: z.string().max(300),
      }),
    )
    .min(1)
    .max(4),
});
export type SnippetOutput = z.infer<typeof SnippetOutputSchema>;

export const SeoOutputSchema = z.object({
  meta_title: z.string().max(60),
  meta_description: z.string().min(70).max(155),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  custom_excerpt: z.string().max(300),
  tags: z.array(z.string()).min(1).max(6),
  // "" instead of null/nullable: DeepSeek's "strict" tool calling does not
  // handle well the anyOf that the JSON Schema conversion generates for .nullable()
  // (see the commit that introduced this comment). "" is treated as absent.
  og_title: z.string().max(70),
  og_description: z.string().max(200),
  twitter_title: z.string().max(70),
  twitter_description: z.string().max(200),
  primary_keyword: z.string(),
  keyword_notes: z.array(z.string()),
});
export type SeoOutput = z.infer<typeof SeoOutputSchema>;

export const ImagePlanSchema = z.object({
  strategy: z.enum(['unsplash', 'generate', 'skip']),
  // "" instead of null: see note in SeoOutputSchema.
  unsplash_query: z.string(),
  generation_prompt: z.string(),
  orientation: z.enum(['landscape', 'portrait', 'squarish']),
  alt_text: z.string().max(125),
  caption: z.string().max(200),
  reasoning: z.string(),
});
export type ImagePlan = z.infer<typeof ImagePlanSchema>;

export interface DraftTag {
  id: string;
  name: string;
  slug: string;
}

export interface DraftAuthor {
  id: string;
  email: string;
}

/** Normalized snapshot of a Ghost draft, as consumed by the pipeline. */
export interface DraftSnapshot {
  id: string;
  uuid: string;
  slug: string;
  title: string;
  html: string | null;
  lexical: string | null;
  custom_excerpt: string | null;
  feature_image: string | null;
  feature_image_alt: string | null;
  feature_image_caption: string | null;
  meta_title: string | null;
  meta_description: string | null;
  og_title: string | null;
  og_description: string | null;
  twitter_title: string | null;
  twitter_description: string | null;
  tags: DraftTag[];
  authors: DraftAuthor[];
  status: 'draft';
  updated_at: string;
  created_at: string;
  url: string;
}

/** Raw shape returned by the Admin API (only the fields we use). */
export interface RawGhostPost {
  id: string;
  uuid: string;
  slug: string;
  title: string;
  html?: string | null;
  lexical?: string | null;
  custom_excerpt?: string | null;
  feature_image?: string | null;
  feature_image_alt?: string | null;
  feature_image_caption?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  og_title?: string | null;
  og_description?: string | null;
  twitter_title?: string | null;
  twitter_description?: string | null;
  tags?: Array<{ id: string; name: string; slug: string }>;
  authors?: Array<{ id: string; email: string }>;
  status: string;
  updated_at: string;
  created_at: string;
  url: string;
}

export function toDraftSnapshot(raw: RawGhostPost): DraftSnapshot {
  if (raw.status !== 'draft') {
    throw new Error(`Post ${raw.id} is not a draft (status=${raw.status})`);
  }
  return {
    id: raw.id,
    uuid: raw.uuid,
    slug: raw.slug,
    title: raw.title,
    html: raw.html ?? null,
    lexical: raw.lexical ?? null,
    custom_excerpt: raw.custom_excerpt ?? null,
    feature_image: raw.feature_image ?? null,
    feature_image_alt: raw.feature_image_alt ?? null,
    feature_image_caption: raw.feature_image_caption ?? null,
    meta_title: raw.meta_title ?? null,
    meta_description: raw.meta_description ?? null,
    og_title: raw.og_title ?? null,
    og_description: raw.og_description ?? null,
    twitter_title: raw.twitter_title ?? null,
    twitter_description: raw.twitter_description ?? null,
    tags: raw.tags ?? [],
    authors: raw.authors ?? [],
    status: 'draft',
    updated_at: raw.updated_at,
    created_at: raw.created_at,
    url: raw.url,
  };
}

/** Body to be sent in the update PUT. `updated_at` is filled in at write-back (M7), never here. */
export interface PostPatch {
  title?: string;
  html?: string;
  lexical?: string;
  meta_title?: string;
  meta_description?: string;
  slug?: string;
  custom_excerpt?: string;
  og_title?: string;
  og_description?: string;
  twitter_title?: string;
  twitter_description?: string;
  /** null clears the field in Ghost (removing the featured image). */
  feature_image?: string | null;
  feature_image_alt?: string | null;
  feature_image_caption?: string | null;
  tags?: Array<{ id: string } | { name: string }>;
  status: 'draft';
}

export interface UploadedFeatureImage {
  url: string;
  alt: string;
  caption: string | null;
}

export interface RunArtifact {
  runId: string;
  postId: string;
  postTitle: string;
  createdAt: string;
  snapshot: DraftSnapshot;
  writer: WriterOutput | null;
  seo: SeoOutput | null;
  imagePlan: ImagePlan | null;
  uploadedImage: UploadedFeatureImage | null;
  patch: PostPatch;
  /** `source` query param to use in the PUT/POST when the patch carries `html`. */
  contentSource?: 'html';
  /** Additional editor instructions used to generate this plan, if any. */
  extraInstructions?: string;
  /** Sources (URLs) read before writing: what could and could not be read. */
  sources?: Array<{ url: string; ok: boolean; note?: string; suspicious?: boolean }>;
  /** Links the article may use besides those in the draft and instructions: those from the sources read and the editor's answers. */
  allowedLinks?: string[];
  /** Image candidates found (not downloaded) for the editor to choose from. */
  imageOptions?: { query: string; options: import('./images/provider.js').ImageOption[]; notes: string[]; source?: string; at: string };
  /**
   * Image chosen by the editor: a candidate (downloaded and uploaded on
   * apply; replaces the post's current one if it has one), 'none' (no new
   * image) or 'remove' (clear the featured image the post already has).
   * With no choice, apply sets NO image and keeps an existing one.
   */
  imageChoice?:
    | {
        kind: 'option';
        option: import('./images/provider.js').ImageOption;
        /** Copy downloaded into DATA_DIR/images (relative to DATA_DIR): previewed locally and uploaded to Ghost only on apply. */
        localFile: string;
        contentType: string;
        alt: string;
        /** Custom caption text (no HTML); the source attribution is always appended after it. */
        captionText: string;
      }
    | { kind: 'none' }
    | { kind: 'remove' };
  /** Editor answers to this plan's [[PENDING:]] (the most recent per question), so they can be corrected. */
  answers?: Array<{ question: string; answer: string; at: string }>;
  /** Whether the editor hand-edited the plan in the UI before applying it. */
  editedAt?: string;
  /** Ghost's updated_at right after a successful apply: restoring is only allowed while it still matches. */
  appliedUpdatedAt?: string;
  /** When the post was put back to `snapshot` (undoing this apply). */
  restoredAt?: string;
  /**
   * `usd` only sums calls with a known price; `unpricedModels` lists
   * models without a price (AI_PRICES), in which case the cost is incomplete.
   */
  cost: {
    inputTokens: number;
    outputTokens: number;
    usd: number;
    unpricedModels?: string[];
    /** USD per agent (plans from before this have no breakdown). */
    byAgent?: Partial<Record<CostAgent, number>>;
  };
  errors: Array<{ stage: string; message: string }>;
  status: 'planned' | 'applied' | 'failed' | 'skipped' | 'conflict';
}

/** Who spent it: the plan's agents, plus answering pending items and "Fix with AI". */
export type CostAgent = 'writer' | 'seo' | 'image' | 'resolve' | 'fix' | 'ideas' | 'snippet';

// ---------- Enriched result of applyArtifact (write-back) ----------

export type ApplyReasonCode =
  | 'ok'
  | 'conflict-updated-at'
  | 'not-draft'
  | 'pending-unresolved'
  | 'sanity-body-ratio'
  | 'unknown-links'
  | 'ghost-put-failed'
  | 'no-writer-output'
  | 'not-planned'
  | 'write-locked';

export type ImageOutcome =
  | { kind: 'not-chosen' }
  | { kind: 'removed' }
  | { kind: 'uploaded'; url: string }
  | { kind: 'skipped-existing' }
  | { kind: 'skipped-plan' }
  | { kind: 'quota-exhausted' }
  | { kind: 'failed'; message: string }
  | { kind: 'none' };

export interface SanityCheckResult {
  wordsBefore: number;
  wordsAfter: number;
  ratio: number;
  min: number;
  max: number;
  ok: boolean;
}

export interface WritebackResult {
  status: 'applied' | 'conflict' | 'skipped' | 'failed';
  reasonCode: ApplyReasonCode;
  message: string;
  image: ImageOutcome;
  sanity?: SanityCheckResult;
  conflict?: { plannedUpdatedAt: string; actualUpdatedAt: string };
  pending?: string[];
  unknownLinks?: string[];
}
