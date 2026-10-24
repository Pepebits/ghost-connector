import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ghostLimiter } from '../util/limiter.js';
import { withRetry } from '../util/retry.js';
import { ghostApi } from './client.js';

export interface UploadedImage {
  url: string;
  ref?: string;
}

const MAX_BYTES = 5 * 1024 * 1024;

/** Uploads an image to Ghost via multipart. The SDK only accepts file paths. */
export async function uploadImage(buffer: Buffer, filename: string, ref: string): Promise<UploadedImage> {
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(`Image too large for Ghost: ${buffer.byteLength} bytes (limit ${MAX_BYTES})`);
  }

  const dir = await mkdtemp(join(tmpdir(), 'ghost-connector-'));
  const filePath = join(dir, filename);
  try {
    await writeFile(filePath, buffer);
    const result = await ghostLimiter(() =>
      withRetry(() => ghostApi().images.upload({ file: filePath, ref, purpose: 'image' })),
    );
    return { url: result.url, ref: result.ref };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
