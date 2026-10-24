import { describe, expect, it } from 'vitest';
import { renderGhostPreview, renderWriterPreview } from '../../src/web/views/preview.js';

describe('web/preview', () => {
  it('highlights [[PENDING:]] in text but never inside an attribute', () => {
    const html = renderWriterPreview('[link](https://a.test "[[PENDING: x]]") and [[PENDING: y]]');
    expect(html).toContain('<mark class="pending-marker"');
    expect(html.match(/<mark/g)).toHaveLength(1);
    expect(html).toMatch(/title="\[\[PENDING: x\]\]"/);
  });

  it('draft images load without a referrer and scripts never survive', () => {
    const html = renderGhostPreview('<p><img src="https://img.test/a.png" onerror="alert(1)"><script>alert(2)</script></p>');
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).not.toMatch(/onerror|<script/);
  });
});
