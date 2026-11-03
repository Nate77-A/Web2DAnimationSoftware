// Self-contained animated GIF89a encoder: median-cut palette per frame + LZW. Runs in a worker or main thread.

export interface GifFrameInput { data: Uint8ClampedArray; delayCs: number }
export interface GifOptions { width: number; height: number; maxColors: number; loop: boolean; transparent: boolean }

class ByteWriter {
  buf: Uint8Array<ArrayBuffer> = new Uint8Array(1 << 16);
  len = 0;
  byte(b: number) {
    if (this.len >= this.buf.length) { const n = new Uint8Array(this.buf.length * 2); n.set(this.buf); this.buf = n; }
    this.buf[this.len++] = b & 0xff;
  }
  u16(v: number) { this.byte(v & 0xff); this.byte((v >> 8) & 0xff); }
  bytes(arr: ArrayLike<number>) { for (let i = 0; i < arr.length; i++) this.byte(arr[i]); }
  str(s: string) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  result(): Uint8Array<ArrayBuffer> { return this.buf.slice(0, this.len); }
}

interface Box { colors: Uint32Array; } // packed 0x00RRGGBB

/** Median-cut quantization over sampled opaque pixels. Returns palette as flat RGB. */
export function quantize(data: Uint8ClampedArray, maxColors: number): Uint8Array {
  const n = data.length / 4;
  const step = Math.max(1, Math.floor(n / 40000));
  const samples: number[] = [];
  for (let i = 0; i < n; i += step) {
    const o = i * 4;
    if (data[o + 3] < 128) continue;
    samples.push((data[o] << 16) | (data[o + 1] << 8) | data[o + 2]);
  }
  if (!samples.length) return new Uint8Array([0, 0, 0]);
  let boxes: Box[] = [{ colors: Uint32Array.from(samples) }];
  while (boxes.length < maxColors) {
    // split the box with the largest channel range * population
    let best = -1, bestScore = -1, bestCh = 0;
    boxes.forEach((b, i) => {
      if (b.colors.length < 2) return;
      let r0 = 255, r1 = 0, g0 = 255, g1 = 0, b0 = 255, b1 = 0;
      for (const c of b.colors) {
        const r = c >> 16, g = (c >> 8) & 255, bl = c & 255;
        if (r < r0) r0 = r; if (r > r1) r1 = r; if (g < g0) g0 = g; if (g > g1) g1 = g; if (bl < b0) b0 = bl; if (bl > b1) b1 = bl;
      }
      const ranges = [r1 - r0, g1 - g0, b1 - b0];
      const ch = ranges.indexOf(Math.max(...ranges));
      const score = ranges[ch] * Math.sqrt(b.colors.length);
      if (score > bestScore) { bestScore = score; best = i; bestCh = ch; }
    });
    if (best < 0 || bestScore <= 0) break;
    const shift = bestCh === 0 ? 16 : bestCh === 1 ? 8 : 0;
    const sorted = boxes[best].colors.slice().sort((a, b) => ((a >> shift) & 255) - ((b >> shift) & 255));
    const mid = sorted.length >> 1;
    boxes = [...boxes.slice(0, best), { colors: sorted.slice(0, mid) }, { colors: sorted.slice(mid) }, ...boxes.slice(best + 1)];
  }
  const pal = new Uint8Array(boxes.length * 3);
  boxes.forEach((b, i) => {
    let r = 0, g = 0, bl = 0;
    for (const c of b.colors) { r += c >> 16; g += (c >> 8) & 255; bl += c & 255; }
    const k = b.colors.length || 1;
    pal[i * 3] = Math.round(r / k); pal[i * 3 + 1] = Math.round(g / k); pal[i * 3 + 2] = Math.round(bl / k);
  });
  return pal;
}

function mapPixels(data: Uint8ClampedArray, pal: Uint8Array, transparentIndex: number): Uint8Array {
  const n = data.length / 4;
  const out = new Uint8Array(n);
  const cache = new Int16Array(32768).fill(-1);
  const count = pal.length / 3;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (transparentIndex >= 0 && data[o + 3] < 128) { out[i] = transparentIndex; continue; }
    const key = ((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3);
    let idx = cache[key];
    if (idx < 0) {
      let bestD = Infinity;
      idx = 0;
      for (let j = 0; j < count; j++) {
        const dr = data[o] - pal[j * 3], dg = data[o + 1] - pal[j * 3 + 1], db = data[o + 2] - pal[j * 3 + 2];
        const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
        if (d < bestD) { bestD = d; idx = j; }
      }
      cache[key] = idx;
    }
    out[i] = idx;
  }
  return out;
}

function lzw(w: ByteWriter, indices: Uint8Array, minCodeSize: number) {
  w.byte(minCodeSize);
  let cur = 0, curShift = 0;
  const block: number[] = [];
  const flushBlock = () => { if (!block.length) return; w.byte(block.length); w.bytes(block); block.length = 0; };
  const emit = (code: number, size: number) => {
    cur |= code << curShift;
    curShift += size;
    while (curShift >= 8) {
      block.push(cur & 0xff);
      if (block.length === 255) flushBlock();
      cur >>>= 8;
      curShift -= 8;
    }
  };
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1, next = eoi + 1;
  let table = new Map<number, number>();
  emit(clear, codeSize);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix, codeSize);
    if (next === 4096) {
      emit(clear, codeSize);
      next = eoi + 1;
      codeSize = minCodeSize + 1;
      table = new Map();
    } else {
      if (next >= 1 << codeSize) codeSize++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix, codeSize);
  emit(eoi, codeSize);
  if (curShift > 0) { block.push(cur & 0xff); if (block.length === 255) flushBlock(); }
  flushBlock();
  w.byte(0);
}

export function encodeGif(frames: GifFrameInput[], o: GifOptions, onFrame?: (i: number) => void): Uint8Array {
  const w = new ByteWriter();
  w.str('GIF89a');
  w.u16(o.width); w.u16(o.height);
  w.byte(0x70); // no global color table, color resolution 8 bits
  w.byte(0); w.byte(0);
  if (o.loop) {
    w.byte(0x21); w.byte(0xff); w.byte(11); w.str('NETSCAPE2.0'); w.byte(3); w.byte(1); w.u16(0); w.byte(0);
  }
  const colorsAvail = Math.max(2, Math.min(256, o.maxColors)) - (o.transparent ? 1 : 0);
  frames.forEach((f, i) => {
    const pal = quantize(f.data, colorsAvail);
    let count = pal.length / 3;
    const tIndex = o.transparent ? count : -1;
    if (o.transparent) count += 1;
    let bits = 1;
    while (1 << bits < count) bits++;
    const size = 1 << bits;
    const table = new Uint8Array(size * 3);
    table.set(pal);
    const idx = mapPixels(f.data, pal, tIndex);
    // Graphic control extension
    w.byte(0x21); w.byte(0xf9); w.byte(4);
    w.byte(((o.transparent ? 2 : 1) << 2) | (o.transparent ? 1 : 0)); // disposal: restore-to-bg when transparent
    w.u16(Math.max(2, f.delayCs));
    w.byte(o.transparent ? tIndex : 0);
    w.byte(0);
    // Image descriptor + local color table
    w.byte(0x2c); w.u16(0); w.u16(0); w.u16(o.width); w.u16(o.height);
    w.byte(0x80 | (bits - 1));
    w.bytes(table);
    lzw(w, idx, Math.max(2, bits));
    onFrame?.(i);
  });
  w.byte(0x3b);
  return w.result();
}

/** Delays in centiseconds with accumulated rounding so total duration matches fps exactly. */
export function gifDelays(count: number, fps: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(Math.round(((i + 1) * 100) / fps) - Math.round((i * 100) / fps));
  return out;
}
