import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Valid-but-fake values so getConfig() doesn't fail in tests.
// dotenv (called inside config.ts) doesn't overwrite env vars that are
// already set, so this takes precedence over the project's real .env.
process.env.GHOST_API_URL ??= 'https://example.test';
process.env.GHOST_ADMIN_API_KEY ??= `${'a'.repeat(24)}:${'b'.repeat(64)}`;
process.env.AI_API_KEY ??= 'test-ai-key';
// View tests check English text (the default language).
process.env.UI_LANGUAGE ??= 'en';

// Isolates the SQLite index and each test run's artifacts in their own
// temp directory: never touches the project's real .runs/.
process.env.DATA_DIR ??= mkdtempSync(join(tmpdir(), 'ghost-connector-test-'));
