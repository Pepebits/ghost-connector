import { describe, expect, it } from 'vitest';
import { escapeHtml, html, raw } from '../../src/web/html.js';

describe('web/html (escape by default)', () => {
  it('escapes a normal interpolation', () => {
    const evil = '<script>alert(1)</script>';
    expect(html`<div>${evil}</div>`).toBe('<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>');
  });

  it('does not escape content wrapped in raw()', () => {
    const safe = raw('<b>bold</b>');
    expect(html`<div>${safe}</div>`).toBe('<div><b>bold</b></div>');
  });

  it('escapes double and single quotes', () => {
    expect(escapeHtml(`"quo'te"`)).toBe('&quot;quo&#39;te&quot;');
  });

  it('treats null/undefined/false as an empty string', () => {
    expect(html`<span>${null}${undefined}${false}</span>`).toBe('<span></span>');
  });

  it('escapes each element of an array of values', () => {
    expect(html`<ul>${['<a>', '<b>']}</ul>`).toBe('<ul>&lt;a&gt;&lt;b&gt;</ul>');
  });
});

describe('provisionalTitle', async () => {
  const { provisionalTitle } = await import('../../src/web/server.js');
  it('cuts at a word with an ellipsis, and leaves short topics alone', () => {
    const topic = 'El impacto del cambio de arquitectura de vehículos actuales basados en múltiples ECUs hacia el SDV';
    const out = provisionalTitle(topic);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith('…')).toBe(true);
    expect(topic.startsWith(out.slice(0, -1))).toBe(true);
    expect(topic[out.length - 1]).toBe(' ');
    expect(provisionalTitle('Huerto urbano')).toBe('Huerto urbano');
  });
});
