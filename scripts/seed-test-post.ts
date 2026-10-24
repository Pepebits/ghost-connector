import { getConfig } from '../src/config.js';
import { logger } from '../src/logger.js';
import { createDraft, readDraft } from '../src/ghost/posts.js';

export const TEST_TAG = '#connector-test';

// Deliberately substantial (not just 2 sentences): a real incomplete
// draft has a body, and the write-back sanity heuristic
// (src/orchestrator/writeback.ts) rejects expansions over 4x, so
// the test fixture needs a realistic starting size.
const TEST_HTML = `
<p>Este es un borrador de prueba para el conector DeepSeek + Ghost. El primer
párrafo da contexto general del tema pero deja detalles clave sin resolver a
propósito, para poder verificar que el agente de redacción es capaz de
completarlo sin inventar datos que no puede saber.</p>
<p>El segundo párrafo continúa la idea: el conector combina tres subagentes
especializados (redacción, SEO y selección de imagen) que corren sobre
DeepSeek, y escribe los resultados de vuelta al sitio a través de la Admin
API de Ghost. El objetivo es que un editor humano revise el resultado antes
de que cualquier cosa se publique, nunca al reves.</p>
<p>Un tercer párrafo explica que el flujo tiene dos pasos separados: primero
"plan", que solo genera y guarda el resultado localmente sin tocar Ghost, y
despues "apply", que escribe el cambio en el post manteniendolo siempre en
estado borrador. Cada aplicación queda ademas guardada como una revision en
el historial de Ghost, para poder deshacerla si hace falta.</p>
<p>Más adelante se hablará de un caso práctico concreto, pero el desarrollo
de esa sección quedó pendiente a propósito.</p>
<h2></h2>
`.trim();

async function main() {
  const cfg = getConfig();

  if (cfg.TEST_POST_ID) {
    try {
      const existing = await readDraft(cfg.TEST_POST_ID);
      logger.warn(
        { id: existing.id, title: existing.title },
        'TEST_POST_ID is already set and the post exists. Not creating a new one. Remove TEST_POST_ID from .env to force creating another.',
      );
      return;
    } catch {
      logger.warn({ id: cfg.TEST_POST_ID }, 'TEST_POST_ID in .env does not resolve to an existing post. Creating a new one.');
    }
  }

  const draft = await createDraft({
    title: '[TEST] Conector DeepSeek',
    html: TEST_HTML,
    tags: [TEST_TAG],
  });

  logger.info(
    { id: draft.id, slug: draft.slug, url: draft.url },
    'Test post created. Copy this id into TEST_POST_ID in .env',
  );
  logger.info(
    { filter: `status:draft+tag:hash-connector-test` },
    'Recommended: use this filter (DRAFT_FILTER) while developing, so real drafts are not touched',
  );
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'seed-test-post failed');
  process.exit(1);
});
