import { appendJobEvent, type JobEventRecord } from '../db/jobs.js';

type Listener = (event: JobEventRecord) => void;

const listeners = new Map<string, Set<Listener>>();

/** Subscribes to a job's LIVE events. Returns the unsubscribe function. */
export function onJobEvent(jobId: string, listener: Listener): () => void {
  let set = listeners.get(jobId);
  if (!set) {
    set = new Set();
    listeners.set(jobId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) listeners.delete(jobId);
  };
}

/**
 * Persists the event (job_events) and pushes it to whoever is listening
 * live. Persistence comes first: if nobody is watching, the log still
 * exists and a page refresh recovers it via listJobEvents(sinceId).
 */
export function emitJobEvent(jobId: string, level: 'info' | 'warn' | 'error', message: string, data?: unknown): void {
  const event = appendJobEvent(jobId, level, message, data);
  for (const listener of listeners.get(jobId) ?? []) listener(event);
}
