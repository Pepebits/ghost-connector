import { describe, expect, it, vi } from 'vitest';
import { isDue, pickNeverPlanned } from '../src/jobs/scheduler.js';

describe('jobs/scheduler', () => {
  const at = (h: number, m: number) => new Date(2026, 9, 13, h, m);
  it('toca una vez al dia, desde la hora indicada', () => {
    expect(isDue('07:00', undefined, at(6, 59))).toBe(false);
    expect(isDue('07:00', undefined, at(7, 0))).toBe(true);
    expect(isDue('07:00', '2026-10-13', at(9, 0))).toBe(false);
    expect(isDue('07:00', '2026-10-12', at(23, 0))).toBe(true);
    expect(isDue('', undefined, at(9, 0))).toBe(false);
    expect(isDue('7h', undefined, at(9, 0))).toBe(false);
  });
  it('elige solo borradores nunca planificados, los mas antiguos, con tope', () => {
    const drafts = [
      { id: 'a', updated_at: '2026-10-03', k: 'never-planned' },
      { id: 'b', updated_at: '2026-10-01', k: 'never-planned' },
      { id: 'c', updated_at: '2026-09-01', k: 'planned' },
      { id: 'd', updated_at: '2026-10-02', k: 'never-planned' },
    ];
    expect(pickNeverPlanned(drafts, (d) => d.k, 2)).toEqual(['b', 'd']);
  });
});

describe('aviso de la planificacion automatica', () => {
  it('se muestra 20 h, no si no hubo nada nuevo ni si se descarto', async () => {
    const { setMeta } = await import('../src/db/repo.js');
    const { autoPlanNotice, dismissAutoPlanNotice } = await import('../src/jobs/scheduler.js');
    const at = '2026-10-24T07:00:00.000Z';
    const now = Date.parse(at);
    setMeta('auto_plan_last_result', JSON.stringify({ at, jobId: 'j1', planned: 2 }));
    expect(autoPlanNotice(now + 3600_000)).toMatchObject({ planned: 2, jobId: 'j1' });
    expect(autoPlanNotice(now + 21 * 3600_000)).toBeNull();
    dismissAutoPlanNotice();
    expect(autoPlanNotice(now + 3600_000)).toBeNull();
    setMeta('auto_plan_last_result', JSON.stringify({ at, jobId: null, planned: 0, reason: 'none' }));
    expect(autoPlanNotice(now + 3600_000)).toBeNull();
  });
});

describe('runAutoPlan', () => {
  it('si Ghost falla no marca el dia (se reintenta)', async () => {
    vi.resetModules();
    vi.doMock('../src/ghost/posts.js', () => ({ listDrafts: async () => { throw new Error('ECONNRESET'); } }));
    const { getMeta, setMeta } = await import('../src/db/repo.js');
    setMeta('auto_plan_last_day', '2000-01-01');
    const { runAutoPlan } = await import('../src/jobs/scheduler.js');
    await expect(runAutoPlan()).rejects.toThrow('ECONNRESET');
    expect(getMeta('auto_plan_last_day')).toBe('2000-01-01');
    vi.doUnmock('../src/ghost/posts.js');
  });
});
