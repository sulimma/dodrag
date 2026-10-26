import { describe, expect, it } from 'vitest';
import { classifyTarget, fileDropText, mediaSource, parseSourcePayload, tokenizeTargets } from './targets';

describe('shared editor/log targets', () => {
  it('recognizes raw dot-atom mail with every atext character and encodes only the URL destination', () => {
    const local = "AZaz09.!#$%&'*+-/=?^_`{|}~";
    const address = `${local}@Example.123`;
    const destination = 'mailto:AZaz09.%21%23%24%25%26%27%2A%2B-%2F%3D%3F%5E_%60%7B%7C%7D~@Example.123';
    expect(classifyTarget(address)).toEqual({ kind: 'url', value: destination });
    const text = `Contact <${address}>, next person@example.org.`;
    const tokens = tokenizeTargets(text);
    expect(tokens.map(token => token.value)).toEqual([destination, 'mailto:person@example.org']);
    expect(tokens.map(token => text.slice(token.start, token.end))).toEqual([address, 'person@example.org']);
    const url = new URL(destination);
    expect(url.search).toBe(''); expect(url.hash).toBe('');
    expect(decodeURIComponent(url.pathname)).toBe(address);
    expect(parseSourcePayload(JSON.stringify({ kind: 'url', value: destination }))).toEqual({ kind: 'url', value: destination });
    expect(classifyTarget('mailto:person@example.org?subject=Hello%20there')).toEqual({ kind: 'url', value: 'mailto:person@example.org?subject=Hello%20there' });
  });
  it('retains simplified quoted locals including spaces and special characters', () => {
    const address = '"space # ? % / : <> (text)"@example.org';
    const destination = 'mailto:%22space%20%23%20%3F%20%25%20%2F%20%3A%20%3C%3E%20%28text%29%22@example.org';
    expect(classifyTarget(address)).toEqual({ kind: 'url', value: destination });
    const text = `Contact ${address}.`;
    const [token] = tokenizeTargets(text);
    expect(token.value).toBe(destination);
    expect(text.slice(token.start, token.end)).toBe(address);
  });
  it('rejects invalid email boundaries rather than linking a valid-looking suffix', () => {
    for (const address of ['.person@example.org', 'person.@example.org', 'per..son@example.org', 'person@example',
      'person@exam..ple.org', 'person@example.org.more-part', 'person@example.org..more', 'person@example.org@other.org',
      '"person@name"@example.org', '"person\\"name"@example.org', '"person\\@name"@example.org', '"person\\"@example.org',
      '"person\nname"@example.org', 'person\x00@example.org']) {
      expect(classifyTarget(address), address).toBeUndefined();
      expect(tokenizeTargets(address), address).toEqual([]);
    }
    expect(tokenizeTargets('(person@example.org), other+tag@example.123!').map(token => token.value)).toEqual([
      'mailto:person@example.org', 'mailto:other%2Btag@example.123',
    ]);
  });
  it('recognizes communication links and normalizes only bare 8-15 digit telephone numbers', () => {
    const text = 'mailto:person@example.org sip:person@example.org tel:+493012345678 Call +49 (30) 1234_5678. 1234567; 1234567890123456';
    expect(tokenizeTargets(text).map(token => token.value)).toEqual([
      'mailto:person@example.org', 'sip:person@example.org', 'tel:+493012345678', 'tel:+493012345678',
    ]);
    expect(classifyTarget('(030) 123-45678')).toEqual({ kind: 'url', value: 'tel:03012345678' });
    expect(classifyTarget('123456789012345')).toEqual({ kind: 'url', value: 'tel:123456789012345' });
    expect(classifyTarget('tel:+49 (30) 1234_5678')).toEqual({ kind: 'url', value: 'tel:+493012345678' });
    expect(classifyTarget('sip:12345678')).toEqual({ kind: 'url', value: 'sip:12345678' });
    expect(tokenizeTargets('Call tel:+49 (30) 1234_5678. sip:12345678').map(token => token.value)).toEqual(['tel:+493012345678', 'sip:12345678']);
    for (const value of ['tel:()', 'mailto:', 'sip:', 'tel:123?command=evil', 'mailto:person@example.org?subject=%0D%0ABcc:evil@example.org', 'https:user@example.org', 'https:///example.org', '2026-10-26']) expect(classifyTarget(value)).toBeUndefined();
  });
  it('validates untrusted source payload schema and value', () => {
    expect(parseSourcePayload(JSON.stringify({ kind: 'url', value: 'mailto:person@example.org' }))).toEqual({ kind: 'url', value: 'mailto:person@example.org' });
    expect(parseSourcePayload(JSON.stringify({ kind: 'path', value: 'C:\\folder' }))).toEqual({ kind: 'path', value: 'C:\\folder' });
    for (const raw of ['{}', 'null', '[]', '{', '{"kind":"url","value":"javascript:alert(1)"}', '{"kind":"path","value":"https://example.org"}', '{"kind":"path","value":"C:\\\\file:stream"}']) expect(parseSourcePayload(raw)).toBeUndefined();
  });
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
