import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who is behind the current request: set by the server's auth hook, read by
 * the views (header, nav) and by what records authorship (jobs, applies)
 * without threading the user through every call.
 */

/** owner: one per panel (keys, export/import, admins); admin: settings and editors; editor: the editorial work. */
export type Role = 'owner' | 'admin' | 'editor';

/** Admins and the owner can enter Settings. */
export const isAdminRole = (role: Role | undefined) => role === 'owner' || role === 'admin';

export interface AuthUser {
  id: number;
  username: string;
  role: Role;
}

const als = new AsyncLocalStorage<{ user: AuthUser | null; actor: string | null; nonce?: string }>();

export function runWithUser<T>(user: AuthUser | null, fn: () => T, nonce?: string): T {
  return als.run({ user, actor: user?.username ?? null, nonce: nonce ?? als.getStore()?.nonce }, fn);
}

/** This response's CSP nonce, for the few inline <script> tags (see web/server.ts). */
export function cspNonce(): string {
  return als.getStore()?.nonce ?? '';
}

/** Runs background work on behalf of a user (a job started by them). */
export function runAsActor<T>(actor: string | null, fn: () => T): T {
  return als.run({ user: als.getStore()?.user ?? null, actor }, fn);
}

export function currentUser(): AuthUser | null {
  return als.getStore()?.user ?? null;
}

/** Username to record as the author; null for automatic work (nightly plan, CLI). */
export function currentActor(): string | null {
  return als.getStore()?.actor ?? null;
}
