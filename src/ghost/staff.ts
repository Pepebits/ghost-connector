import { ghostLimiter } from '../util/limiter.js';
import { withRetry } from '../util/retry.js';
import { ghostApi } from './client.js';

/**
 * Ghost staff (read-only), to credit posts to their authors. Suspended and
 * deactivated people are left out. Cached for a few minutes: it changes rarely
 * and every form with an author picker would ask for it otherwise.
 */

export interface StaffMember {
  id: string;
  name: string;
  slug: string;
}

const TTL_MS = 5 * 60_000;
let cache: { at: number; staff: StaffMember[] } | null = null;

/** Ghost statuses that can't be credited: suspended ("locked") and deactivated ("inactive"). */
export function activeStaff(users: Array<{ id: string; name?: string | null; slug: string; status?: string }>): StaffMember[] {
  return users
    .filter((u) => u.status !== 'inactive' && u.status !== 'locked')
    .map((u) => ({ id: u.id, name: u.name || u.slug, slug: u.slug }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listStaff(fresh = false): Promise<StaffMember[]> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.staff;
  const users = (await ghostLimiter(() => withRetry(() => ghostApi().users.browse({ limit: 100, fields: 'id,name,slug,status' })))) as Array<{ id: string; name: string; slug: string; status: string }>;
  cache = { at: Date.now(), staff: activeStaff(users) };
  return cache.staff;
}

/** The last list read (no Ghost call): for views rendered synchronously after a listStaffSafe(). */
export function cachedStaff(): StaffMember[] {
  return cache?.staff ?? [];
}

/** Same, but an empty list instead of an error (Ghost down): the pickers just don't show. */
export async function listStaffSafe(): Promise<StaffMember[]> {
  try {
    return await listStaff();
  } catch {
    return cache?.staff ?? [];
  }
}

/**
 * The authors picked in a form: `authors` (checked ids, one or many) and
 * `primary` (the radio). Primary first, only known staff, no duplicates.
 */
export function pickedAuthors(body: { authors?: string | string[]; primary?: string }, staff: StaffMember[]): string[] {
  const known = new Set(staff.map((s) => s.id));
  const ids = [...new Set((Array.isArray(body.authors) ? body.authors : body.authors ? [body.authors] : []).filter((id) => known.has(id)))];
  const primary = body.primary && ids.includes(body.primary) ? body.primary : ids[0];
  return primary ? [primary, ...ids.filter((id) => id !== primary)] : [];
}
