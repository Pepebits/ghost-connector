import { describe, expect, it } from 'vitest';
import { extractPartialStringField } from '../../src/jobs/liveDraft.js';

describe('extractPartialStringField', () => {
  it('returns null if the field has not started yet', () => {
    expect(extractPartialStringField('{"title":"Hola","mark', 'markdown')).toBeNull();
  });

  it('returns the truncated value of a partial field, with escapes decoded', () => {
    const partial = '{"title":"X","markdown":"## Uno\\n\\nTexto con \\"comillas\\" y \\u00f1 y mas';
    expect(extractPartialStringField(partial, 'markdown')).toBe('## Uno\n\nTexto con "comillas" y ñ y mas');
  });

  it('stops at the closing quote of the field', () => {
    expect(extractPartialStringField('{"markdown":"fin","outline":["a"', 'markdown')).toBe('fin');
  });

  it('does not break on a truncated escape at the end', () => {
    expect(extractPartialStringField('{"markdown":"abc\\', 'markdown')).toBe('abc');
    expect(extractPartialStringField('{"markdown":"abc\\u00', 'markdown')).toBe('abc');
  });
});
