import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { encodeGif, gifDelays } from '../features/export/gifEncoder';
import { muxMp4 } from '../features/export/mp4Muxer';

/** Minimal GIF decoder (first frame) used to verify the encoder's LZW and palette contract. */
function decodeFirstFrame(bytes: Uint8Array) {
  let i = 13;
  const w = bytes[6] | (bytes[7] << 8), h = bytes[8] | (bytes[9] << 8);
  let delay = -1, transparent = -1;
  while (bytes[i] === 0x21) {
    if (bytes[i + 1] === 0xf9) { delay = bytes[i + 4] | (bytes[i + 5] << 8); if (bytes[i + 3] & 1) transparent = bytes[i + 6]; }
    i += 2;
    while (bytes[i]) i += bytes[i] + 1;
    i++;
  }
  assert.equal(bytes[i], 0x2c);
  const packed = bytes[i + 9];
  const size = 1 << ((packed & 7) + 1);
  const table = bytes.slice(i + 10, i + 10 + size * 3);
  i += 10 + size * 3;
  const minCode = bytes[i++];
  const data: number[] = [];
  while (bytes[i]) { const n = bytes[i]; data.push(...bytes.slice(i + 1, i + 1 + n)); i += n + 1; }
  const clear = 1 << minCode, eoi = clear + 1;
  let codeSize = minCode + 1, dict: number[][] = [], bit = 0, prev: number[] | null = null;
  const reset = () => { dict = []; for (let k = 0; k < clear; k++) dict[k] = [k]; dict[clear] = []; dict[eoi] = []; codeSize = minCode + 1; prev = null; };
  reset();
  const out: number[] = [];
  for (;;) {
    let code = 0;
    for (let b = 0; b < codeSize; b++) { code |= ((data[(bit >> 3)] >> (bit & 7)) & 1) << b; bit++; }
    if (code === clear) { reset(); continue; }
    if (code === eoi) break;
    let entry: number[];
    if (dict[code]) entry = dict[code];
    else entry = [...prev!, prev![0]];
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length === 1 << codeSize && codeSize < 12) codeSize++;
  }
  return { w, h, out, table, delay, transparent };
}

describe('GIF encoder', () => {
  it('round-trips indices and colors through LZW', () => {
    const w = 37, h = 23;
    const data = new Uint8ClampedArray(w * h * 4);
    const colors = [[255, 0, 0], [0, 128, 255], [20, 200, 90], [250, 250, 250]];
    for (let p = 0; p < w * h; p++) {
      const c = colors[(Math.floor(p / 7) + (p % 5)) % 4];
      data.set([...c, 255], p * 4);
    }
    const gif = encodeGif([{ data, delayCs: 4 }, { data, delayCs: 4 }], { width: w, height: h, maxColors: 16, loop: true, transparent: false });
    assert.equal(String.fromCharCode(...gif.slice(0, 6)), 'GIF89a');
    assert.equal(gif[gif.length - 1], 0x3b);
    const d = decodeFirstFrame(gif);
    assert.equal(d.out.length, w * h);
    for (let p = 0; p < w * h; p++) {
      const idx = d.out[p];
      assert.deepEqual([d.table[idx * 3], d.table[idx * 3 + 1], d.table[idx * 3 + 2]], Array.from(data.slice(p * 4, p * 4 + 3)), `pixel ${p}`);
    }
    assert.equal(d.delay, 4);
  });

  it('marks transparent pixels with the transparent index', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let p = 0; p < 16; p++) data.set(p < 8 ? [0, 0, 0, 0] : [10, 20, 30, 255], p * 4);
    const d = decodeFirstFrame(encodeGif([{ data, delayCs: 10 }], { width: 4, height: 4, maxColors: 8, loop: false, transparent: true }));
    assert.ok(d.transparent >= 0);
    assert.ok(d.out.slice(0, 8).every((x) => x === d.transparent));
    assert.ok(d.out.slice(8).every((x) => x !== d.transparent));
  });

  it('delays keep total duration exact for 24 fps', () => {
    const delays = gifDelays(24, 24);
    assert.equal(delays.reduce((a, b) => a + b, 0), 100);
  });
});

describe('MP4 muxer', () => {
  it('writes ftyp, mdat and moov with chunk offsets that point into mdat', () => {
    const samples = [new Uint8Array([0, 0, 0, 2, 0x65, 0x88]), new Uint8Array([0, 0, 0, 1, 0x41]), new Uint8Array([0, 0, 0, 1, 0x41])].map((data, i) => ({ data, key: i === 0 }));
    const mp4 = muxMp4({ width: 64, height: 48, fps: 24, avcC: new Uint8Array([1, 0x42, 0, 0x1f, 0xff, 0xe0, 0x00]), samples });
    const dv = new DataView(mp4.buffer);
    const boxes: Record<string, [number, number]> = {};
    for (let o = 0; o < mp4.length;) { const size = dv.getUint32(o); boxes[String.fromCharCode(...mp4.slice(o + 4, o + 8))] = [o, size]; o += size; }
    assert.deepEqual(Object.keys(boxes), ['ftyp', 'mdat', 'moov']);
    const text = String.fromCharCode(...mp4);
    const stco = text.indexOf('stco');
    const first = dv.getUint32(stco + 12);
    assert.equal(first, boxes.mdat[0] + 8);
    assert.deepEqual(Array.from(mp4.slice(first, first + 6)), Array.from(samples[0].data));
    const stss = text.indexOf('stss');
    assert.equal(dv.getUint32(stss + 8), 1, 'one sync sample');
  });
});
