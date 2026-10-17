// ON2GO storefront: the in-house QR encoder. Reed–Solomon golden vector (the classic "HELLO WORLD" 1-M example), BCH
// format and version bits against the ISO 18004 tables, finder / timing patterns, version chosen by length, and a
// read-back of the placed codewords (unmask + zigzag) that must give the interleaved data exactly.
import { describe, expect, it } from 'vitest';
import { dataCodewords, encodeData, formatBits, interleave, qrEncode, qrSvg, rsEncode, versionBits, versionFor } from '../lib/foodhub/storefront/qr';

describe('Reed–Solomon and BCH', () => {
  it('HELLO WORLD 1-M: data codewords → the 10 published error-correction codewords', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsEncode(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it('format bits for level M, masks 0–7 (ISO 18004 table C.1)', () => {
    const table = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
    expect(Array.from({ length: 8 }, (_, m) => formatBits(m).toString(2).padStart(15, '0'))).toEqual(table);
  });

  it('version bits (versions 7–10, table D.1)', () => {
    expect(versionBits(7).toString(2).padStart(18, '0')).toBe('000111110010010100');
    expect(versionBits(8).toString(2).padStart(18, '0')).toBe('001000010110111100');
    expect(versionBits(9).toString(2).padStart(18, '0')).toBe('001001101010011001');
    expect(versionBits(10).toString(2).padStart(18, '0')).toBe('001010010011010011');
  });
});

describe('symbol', () => {
  it('chooses the smallest version that holds the bytes (level M, byte mode)', () => {
    expect(versionFor(14)).toBe(1);
    expect(versionFor(15)).toBe(2);
    expect(versionFor(26)).toBe(2);
    expect(versionFor(27)).toBe(3);
    expect(versionFor(213)).toBe(10);
    expect(versionFor(214)).toBeNull();
    expect(() => qrEncode('x'.repeat(214))).toThrow(/too long/);
    expect(dataCodewords(1)).toBe(16);
    expect(dataCodewords(10)).toBe(216);
  });

  it('pads with 0xEC / 0x11 after the terminator', () => {
    const d = encodeData(new TextEncoder().encode('A'), 1);
    expect(d).toHaveLength(16);
    expect(d.slice(0, 3)).toEqual([0x40, 0x14, 0x10]); // 0100 · 00000001 · 01000001 · 0000
    expect(d.slice(3, 7)).toEqual([0xec, 0x11, 0xec, 0x11]);
  });

  it('finder, timing, dark module and both format copies are where the standard puts them', () => {
    const url = 'https://hub.example.test/commander/pi-pita?src=qr&table=12';
    const qr = qrEncode(url);
    const n = qr.size;
    expect(n).toBe(qr.version * 4 + 17);
    const m = qr.modules;
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
      for (let d = -3; d <= 3; d++) {
        expect(m[cy - 3][cx + d]).toBe(true); // outer ring
        expect(m[cy + d][cx - 3]).toBe(true);
      }
      expect(m[cy - 2][cx]).toBe(false); // light ring
      expect(m[cy][cx]).toBe(true); // centre
    }
    for (let i = 8; i < n - 8; i++) { expect(m[6][i]).toBe(i % 2 === 0); expect(m[i][6]).toBe(i % 2 === 0); }
    expect(m[n - 8][8]).toBe(true);
    const fmt = formatBits(qr.mask);
    const bit = (i: number) => ((fmt >>> i) & 1) === 1;
    const copy1 = [...[0, 1, 2, 3, 4, 5].map((i) => m[i][8]), m[7][8], m[8][8], m[8][7], ...[9, 10, 11, 12, 13, 14].map((i) => m[8][14 - i])];
    const copy2 = [...Array.from({ length: 8 }, (_, i) => m[8][n - 1 - i]), ...Array.from({ length: 7 }, (_, k) => m[n - 7 + k][8])];
    expect(copy1).toEqual(Array.from({ length: 15 }, (_, i) => bit(i)));
    expect(copy2).toEqual(Array.from({ length: 15 }, (_, i) => bit(i)));
  });

  it('reading the data area back (unmask, zigzag) gives the interleaved codewords, for every mask', () => {
    const text = 'https://hub.example.test/commander/pi-pita?src=google';
    for (let mask = 0; mask < 8; mask++) {
      const qr = qrEncode(text, { mask });
      const expected = interleave(encodeData(new TextEncoder().encode(text), qr.version), qr.version);
      const fn = functionMap(qr.version);
      const cond = maskCond(mask);
      const bits: number[] = [];
      const n = qr.size;
      for (let right = n - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
          const x = right - j; const up = ((right + 1) & 2) === 0; const y = up ? n - 1 - vert : vert;
          if (fn[y][x]) continue;
          bits.push((qr.modules[y][x] !== cond(x, y)) ? 1 : 0);
        }
      }
      const bytes = Array.from({ length: expected.length }, (_, k) => bits.slice(k * 8, k * 8 + 8).reduce((a, b) => (a << 1) | b, 0));
      expect(bytes).toEqual(expected);
      expect(qr.mask).toBe(mask);
    }
  });

  it('picks a mask by penalty and draws a clean SVG with a quiet zone', () => {
    const svg = qrSvg('https://hub.example.test/commander/pi-pita?src=qr', { title: 'a <b> & "c"' });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    const qr = qrEncode('https://hub.example.test/commander/pi-pita?src=qr');
    expect(svg).toContain(`viewBox="0 0 ${qr.size + 8} ${qr.size + 8}"`);
    expect(svg).toContain('<title>a &lt;b&gt; &amp; &quot;c&quot;</title>');
    expect(svg).not.toMatch(/<script/i);
    expect(qr.mask).toBeGreaterThanOrEqual(0);
    expect(qr.mask).toBeLessThan(8);
  });
});

/** Function-pattern map of a version (same layout rules as the encoder, written independently here). */
function functionMap(version: number): boolean[][] {
  const n = version * 4 + 17;
  const f = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const mark = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < n && y < n) f[y][x] = true; };
  for (let i = 0; i < n; i++) { mark(6, i); mark(i, 6); }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) mark(cx + dx, cy + dy);
  const align = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]][version - 1];
  const last = align.length - 1;
  align.forEach((a, i) => align.forEach((b, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(a + dx, b + dy);
  }));
  for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) { mark(n - 1 - i, 8); mark(8, n - 1 - i); }
  if (version >= 7) for (let i = 0; i < 18; i++) { mark(n - 11 + (i % 3), Math.floor(i / 3)); mark(Math.floor(i / 3), n - 11 + (i % 3)); }
  return f;
}

function maskCond(mask: number): (x: number, y: number) => boolean {
  return [
    (x: number, y: number) => (x + y) % 2 === 0,
    (_x: number, y: number) => y % 2 === 0,
    (x: number) => x % 3 === 0,
    (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ][mask];
}
