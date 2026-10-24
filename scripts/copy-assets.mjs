// Copies to dist/ what the code reads from disk at runtime and
// tsc doesn't emit: factory prompts, UI static files (with app.css already
// compiled) and the brand wordmark.
import { cpSync, existsSync } from 'node:fs';

const ASSETS = [
  ['src/agents/prompts', 'dist/agents/prompts'],
  ['src/web/public', 'dist/web/public'],
  ['src/web/brand', 'dist/web/brand'],
  ['src/i18n/locales', 'dist/i18n/locales'],
];

if (!existsSync('src/web/public/app.css')) {
  console.error('Falta src/web/public/app.css: ejecuta antes "npm run css:build".');
  process.exit(1);
}
for (const [from, to] of ASSETS) cpSync(from, to, { recursive: true });
console.log(`Assets copiados: ${ASSETS.map(([, to]) => to).join(', ')}`);
