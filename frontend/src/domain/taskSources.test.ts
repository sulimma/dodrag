import { describe, expect, it } from 'vitest';
import { appendTaskSources } from './taskSources';

describe('source paragraph append', () => {
  it('preserves descriptions and quotes paths with spaces', () => {
    expect(appendTaskSources('Existing text\n', [{ kind: 'path', value: 'C:\\My Files\\a.txt' }, { kind: 'url', value: 'https://example.com/a_(b)' }]))
      .toBe('Existing text\n\n"C:\\My Files\\a.txt"\n\n<https://example.com/a_(b)>');
  });
  it('starts a separate paragraph after an existing numbered list', () => {
    expect(appendTaskSources('1. Existing item', [{ kind: 'url', value: 'https://example.com' }]))
      .toBe('1. Existing item\n\n<https://example.com>');
  });
  it('starts an empty description and rejects untrusted schemes and kinds', () => {
    expect(appendTaskSources('', [{ kind: 'url', value: 'https://example.com' }])).toBe('<https://example.com>');
    expect(() => appendTaskSources('', [{ kind: 'url', value: 'javascript:alert(1)' }])).toThrow();
    expect(() => appendTaskSources('', [{ kind: 'url', value: 'C:\\file.txt' }])).toThrow();
    expect(appendTaskSources('Unchanged\n', [])).toBe('Unchanged\n');
  });
});
