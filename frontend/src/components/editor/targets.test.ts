import { describe, expect, it } from 'vitest';
import { classifyTarget, fileDropText, mediaSource, tokenizeTargets } from './targets';

describe('shared editor/log targets', () => {
  it('recognizes HTTP URLs and balanced punctuation without dangerous schemas', () => {
    const tokens = tokenizeTargets('See https://example.org/a_(b). Then http://example.org/x). javascript:alert(1) file:///C:/a');
    expect(tokens.map(token => token.value)).toEqual(['https://example.org/a_(b)', 'http://example.org/x']);
    for (const value of ['javascript:alert(1)', 'file:///C:/a', 'cmd:/c', 'https://example.org/\\evil']) expect(classifyTarget(value)).toBeUndefined();
  });
  it('retains quoted whitespace drive/UNC paths, share roots and bare drive roots', () => {
    const text = '"G:\\Meine Ablage\\Bild.svg" "\\\\Server\\Team Share\\file.png" \\\\Server\\Share C:\\ D:\\tasks\\note.txt';
    expect(tokenizeTargets(text).map(({ value, image }) => [value, image])).toEqual([
      ['G:\\Meine Ablage\\Bild.svg', true], ['\\\\Server\\Team Share\\file.png', true],
      ['\\\\Server\\Share', false], ['C:\\', false], ['D:\\tasks\\note.txt', false],
    ]);
    expect(classifyTarget('\\\\Server')).toBeUndefined();
    expect(classifyTarget('relative\\file.png')).toBeUndefined();
  });
  it('recognizes local markdown images with whitespace and SVG, including angle destinations', () => {
    const text = '![diagram](<G:\\Meine Ablage\\a (1).svg>) ![](C:\\Pictures\\photo.jpg) ![UNC]("\\\\Server\\Share\\a b.png")';
    const tokens = tokenizeTargets(text);
    expect(tokens.map(token => token.value)).toEqual(['G:\\Meine Ablage\\a (1).svg', 'C:\\Pictures\\photo.jpg', '\\\\Server\\Share\\a b.png']);
    expect(tokens.every(token => token.image && text.slice(token.start, token.end).startsWith('!['))).toBe(true);
  });
  it('encodes preview routes and inserts exact paths quoted for roundtripping', () => {
    expect(mediaSource('t&1', 'C:\\a b.svg')).toBe('/dodrag-media?taskId=t%261&path=C%3A%5Ca%20b.svg');
    expect(fileDropText(['C:\\a b', '\\\\S\\Share'])).toBe('"C:\\a b"\n"\\\\S\\Share"');
  });
  it('rejects unsafe paths atomically without changing valid filenames', () => {
    for (const path of ['relative.txt', 'https://example.org', 'C:relative.txt', 'C:\\bad".txt',
      'C:\\line\nbreak.txt', 'C:\\null\x00.txt', 'C:\\file.txt:stream', '\\\\?\\C:\\file.txt']) {
      expect(() => fileDropText(['C:\\valid.txt', path])).toThrow();
    }
    expect(fileDropText(['C:\\file & %.txt'])).toBe('"C:\\file & %.txt"');
  });
});
