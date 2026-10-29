// QR code encoder written in-house (no npm dependency) for the ordering page's share kit: table tents, window stickers,
// the counter. ISO/IEC 18004: byte mode, error correction level M (~15 % of the code can be damaged), versions 1–10
// (up to 213 bytes — far more than a /commander/<slug>?src=qr&table=12 address), all 8 masks tried with the standard
// penalty score, BCH-protected format and version information.
// qrSvg(text) returns a self-contained SVG (black on white, quiet zone of 4 modules by default).

// ---------------------------------------------------------------------------------------------------------------
// Reed–Solomon over GF(256), primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D).

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** Generator polynomial of the given degree (coefficients after the leading 1, highest power first). */
export function rsGenerator(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

/** The `ecLen` error-correction codewords of a block of data codewords. */
export function rsEncode(data: number[], ecLen: number): number[] {
  const gen = rsGenerator(ecLen);
  const out = new Array<number>(ecLen).fill(0);
  for (const b of data) {
    const factor = b ^ (out.shift() as number);
    out.push(0);
    for (let i = 0; i < gen.length; i++) out[i] ^= gfMul(gen[i], factor);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Level M tables, versions 1–10: [EC codewords per block, blocks in group 1, data codewords per block in group 1,
// blocks in group 2, data codewords per block in group 2].

const LEVEL_M: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
];
const ALIGN: ReadonlyArray<number[]> = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
export const MAX_VERSION = 10;
/** Level M format bits: '00'. */
const ECL_M_BITS = 0;

export function dataCodewords(version: number): number {
  const [, b1, d1, b2, d2] = LEVEL_M[version - 1];
  return b1 * d1 + b2 * d2;
}

const countBits = (version: number) => (version <= 9 ? 8 : 16);

/** Smallest version (1–10) that holds this many bytes at level M; null when too long. */
export function versionFor(byteLength: number): number | null {
  for (let v = 1; v <= MAX_VERSION; v++) if (4 + countBits(v) + byteLength * 8 <= dataCodewords(v) * 8) return v;
  return null;
}

/** Data codewords of the text in byte mode (UTF-8), terminator and padding included. */
export function encodeData(bytes: Uint8Array, version: number): number[] {
  const cap = dataCodewords(version) * 8;
  const bits: number[] = [];
  const put = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, countBits(version));
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < cap / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** Splits into blocks, adds each block's error correction, interleaves (data first, then EC). */
export function interleave(data: number[], version: number): number[] {
  const [ec, b1, d1, b2, d2] = LEVEL_M[version - 1];
  const blocks: number[][] = [];
  let k = 0;
  for (let i = 0; i < b1; i++) { blocks.push(data.slice(k, k + d1)); k += d1; }
  for (let i = 0; i < b2; i++) { blocks.push(data.slice(k, k + d2)); k += d2; }
  const ecBlocks = blocks.map((b) => rsEncode(b, ec));
  const out: number[] = [];
  const longest = Math.max(d1, d2);
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ec; i++) for (const b of ecBlocks) out.push(b[i]);
  return out;
}

/** 15 format bits (level M + mask), BCH(15,5) and the 0x5412 mask. */
export function formatBits(mask: number): number {
  const data = (ECL_M_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** 18 version bits (versions 7 and up), BCH(18,6). */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

// ---------------------------------------------------------------------------------------------------------------
// The symbol

export interface QrCode { version: number; mask: number; size: number; modules: boolean[][] }

class QrSymbol {
  readonly size: number;
  readonly modules: boolean[][];
  readonly fn: boolean[][];
  readonly version: number;
  constructor(version: number) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fn = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.drawFunctionPatterns();
  }

  private set(x: number, y: number, dark: boolean) { this.modules[y][x] = dark; this.fn[y][x] = true; }

  private drawFunctionPatterns() {
    const n = this.size;
    for (let i = 0; i < n; i++) { this.set(6, i, i % 2 === 0); this.set(i, 6, i % 2 === 0); }
    this.finder(3, 3); this.finder(n - 4, 3); this.finder(3, n - 4);
    const pos = ALIGN[this.version - 1];
    const last = pos.length - 1;
    for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      this.alignment(pos[i], pos[j]);
    }
    this.drawFormat(0); // reserves the area; drawn again with the chosen mask
    this.drawVersion();
  }

  private finder(cx: number, cy: number) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx; const y = cy + dy;
      if (x < 0 || y < 0 || x >= this.size || y >= this.size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      this.set(x, y, d !== 2 && d !== 4);
    }
  }

  private alignment(cx: number, cy: number) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }

  drawFormat(mask: number) {
    const b = formatBits(mask);
    const n = this.size;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(b, i));
    this.set(8, 7, bit(b, 6));
    this.set(8, 8, bit(b, 7));
    this.set(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) this.set(n - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) this.set(8, n - 15 + i, bit(b, i));
    this.set(8, n - 8, true); // the dark module
  }

  private drawVersion() {
    if (this.version < 7) return;
    const b = versionBits(this.version);
    for (let i = 0; i < 18; i++) {
      const a = this.size - 11 + (i % 3); const c = Math.floor(i / 3);
      this.set(a, c, bit(b, i)); this.set(c, a, bit(b, i));
    }
  }

  drawCodewords(data: number[]) {
    const n = this.size;
    let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? n - 1 - vert : vert;
          if (!this.fn[y][x] && i < data.length * 8) { this.modules[y][x] = bit(data[i >>> 3], 7 - (i & 7)); i++; }
        }
      }
    }
  }

  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
      if (this.fn[y][x]) continue;
      let invert: boolean;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
      }
      if (invert) this.modules[y][x] = !this.modules[y][x];
    }
  }

  /** Penalty score (ISO 18004 §8.8.2): runs, 2×2 blocks, finder-like patterns, dark balance. */
  penalty(): number {
    const n = this.size;
    const m = this.modules;
    let score = 0;
    const lines: boolean[][] = [];
    for (let y = 0; y < n; y++) lines.push(m[y]);
    for (let x = 0; x < n; x++) lines.push(m.map((row) => row[x]));
    const A = [true, false, true, true, true, false, true, false, false, false, false];
    const B = [false, false, false, false, true, false, true, true, true, false, true];
    for (const line of lines) {
      let run = 1;
      for (let i = 1; i <= n; i++) {
        if (i < n && line[i] === line[i - 1]) { run++; continue; }
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
      for (let i = 0; i + 11 <= n; i++) {
        if (A.every((v, k) => line[i + k] === v) || B.every((v, k) => line[i + k] === v)) score += 40;
      }
    }
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
    let dark = 0;
    for (const row of m) for (const v of row) if (v) dark++;
    const total = n * n;
    score += Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }
}

/** The QR symbol of a text (UTF-8 bytes). `mask` forces a mask (tests); otherwise the lowest penalty wins. */
export function qrEncode(text: string, opts: { mask?: number } = {}): QrCode {
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length);
  if (!version) throw new Error(`Text too long for a QR code (version ${MAX_VERSION} at level M holds ${dataCodewords(MAX_VERSION) - 2} bytes).`);
  const sym = new QrSymbol(version);
  sym.drawCodewords(interleave(encodeData(bytes, version), version));
  let mask = opts.mask ?? -1;
  if (mask < 0) {
    let best = Infinity;
    for (let k = 0; k < 8; k++) {
      sym.drawFormat(k);
      sym.applyMask(k);
      const p = sym.penalty();
      if (p < best) { best = p; mask = k; }
      sym.applyMask(k); // undo (XOR)
    }
  }
  sym.drawFormat(mask);
  sym.applyMask(mask);
  return { version, mask, size: sym.size, modules: sym.modules };
}

/** A self-contained SVG of the QR code: black modules on a white square, `margin` modules of quiet zone (default 4). */
export function qrSvg(text: string, opts: { margin?: number; title?: string } = {}): string {
  const qr = qrEncode(text);
  const margin = Math.max(0, Math.min(10, Math.floor(opts.margin ?? 4)));
  const dim = qr.size + margin * 2;
  let d = '';
  for (let y = 0; y < qr.size; y++) {
    let x = 0;
    while (x < qr.size) {
      if (!qr.modules[y][x]) { x++; continue; }
      let len = 1;
      while (x + len < qr.size && qr.modules[y][x + len]) len++;
      d += `M${x + margin} ${y + margin}h${len}v1h-${len}z`;
      x += len;
    }
  }
  const title = opts.title ? `<title>${opts.title.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!))}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim * 8}" height="${dim * 8}" shape-rendering="crispEdges" role="img">${title}<rect width="${dim}" height="${dim}" fill="#ffffff"/><path d="${d}" fill="#000000"/></svg>`;
}
