import { describe, expect, it } from 'vitest';
import { costChart } from '../../src/web/views/costChart.js';

const days = (usd: number[]) => usd.map((u, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, usd: u, runs: u > 0 ? 1 : 0 }));

describe('costChart', () => {
  it('draws one bar per day, the cap line, and an sr-only table with the days that had runs', () => {
    const out = costChart(days([0, 0.2, 0.1]), 0.5);
    expect(out.match(/chart-col/g)).toHaveLength(3);
    expect(out).toContain('border-dashed');
    expect(out.match(/<tr><td>/g)).toHaveLength(2);
    expect(out).toContain('$0.3000');
  });

  it('says so instead of an empty chart when nothing was spent', () => {
    expect(costChart(days([0, 0]), null)).not.toContain('chart-col');
  });
});
