// Minimal ISO-BMFF (MP4) muxer for a single H.264 video track (length-prefixed "avc" samples).

class W {
  parts: Uint8Array[] = [];
  size = 0;
  push(b: Uint8Array) { this.parts.push(b); this.size += b.length; }
  u8(v: number) { this.push(new Uint8Array([v & 255])); }
  u16(v: number) { this.push(new Uint8Array([(v >> 8) & 255, v & 255])); }
  u32(v: number) { this.push(new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255])); }
  str(s: string) { this.push(new Uint8Array([...s].map((c) => c.charCodeAt(0)))); }
  zeros(n: number) { this.push(new Uint8Array(n)); }
  bytes() { const out = new Uint8Array(this.size); let o = 0; for (const p of this.parts) { out.set(p, o); o += p.length; } return out; }
}

function box(type: string, ...children: (Uint8Array | ((w: W) => void))[]): Uint8Array {
  const w = new W();
  for (const c of children) {
    if (c instanceof Uint8Array) w.push(c);
    else c(w);
  }
  const body = w.bytes();
  const out = new W();
  out.u32(body.length + 8);
  out.str(type);
  out.push(body);
  return out.bytes();
}

const fullBox = (type: string, version: number, flags: number, ...children: (Uint8Array | ((w: W) => void))[]) =>
  box(type, (w) => { w.u8(version); w.u8(flags >> 16); w.u16(flags & 0xffff); }, ...children);

const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

export interface MuxSample { data: Uint8Array; key: boolean }

export function muxMp4(opts: { width: number; height: number; fps: number; avcC: Uint8Array; samples: MuxSample[] }): Uint8Array {
  const { width, height, fps, avcC, samples } = opts;
  const timescale = fps * 1000;
  const delta = 1000;
  const mediaDuration = samples.length * delta;
  const movieDuration = Math.round((samples.length / fps) * 1000);

  const ftyp = box('ftyp', (w) => { w.str('isom'); w.u32(512); w.str('isom'); w.str('iso2'); w.str('avc1'); w.str('mp41'); });
  const mdatHeader = 8;
  const mdatSize = samples.reduce((n, s) => n + s.data.length, 0) + mdatHeader;
  const dataStart = ftyp.length + mdatHeader;
  const offsets: number[] = [];
  let off = dataStart;
  for (const s of samples) { offsets.push(off); off += s.data.length; }

  const mvhd = fullBox('mvhd', 0, 0, (w) => {
    w.u32(0); w.u32(0); w.u32(1000); w.u32(movieDuration);
    w.u32(0x00010000); w.u16(0x0100); w.zeros(10);
    for (const m of MATRIX) w.u32(m);
    w.zeros(24); w.u32(2);
  });
  const tkhd = fullBox('tkhd', 0, 3, (w) => {
    w.u32(0); w.u32(0); w.u32(1); w.u32(0); w.u32(movieDuration);
    w.zeros(8); w.u16(0); w.u16(0); w.u16(0); w.u16(0);
    for (const m of MATRIX) w.u32(m);
    w.u32(width << 16); w.u32(height << 16);
  });
  const mdhd = fullBox('mdhd', 0, 0, (w) => { w.u32(0); w.u32(0); w.u32(timescale); w.u32(mediaDuration); w.u16(0x55c4); w.u16(0); });
  const hdlr = fullBox('hdlr', 0, 0, (w) => { w.u32(0); w.str('vide'); w.zeros(12); w.str('VideoHandler'); w.u8(0); });
  const vmhd = fullBox('vmhd', 0, 1, (w) => { w.u16(0); w.zeros(6); });
  const dinf = box('dinf', fullBox('dref', 0, 0, (w) => w.u32(1), fullBox('url ', 0, 1)));
  const avc1 = box('avc1', (w) => {
    w.zeros(6); w.u16(1); w.u16(0); w.u16(0); w.zeros(12);
    w.u16(width); w.u16(height); w.u32(0x00480000); w.u32(0x00480000); w.u32(0); w.u16(1);
    const name = new Uint8Array(32); w.push(name); w.u16(0x0018); w.u16(0xffff);
  }, box('avcC', avcC));
  const stsd = fullBox('stsd', 0, 0, (w) => w.u32(1), avc1);
  const stts = fullBox('stts', 0, 0, (w) => { w.u32(1); w.u32(samples.length); w.u32(delta); });
  const keys = samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
  const stss = fullBox('stss', 0, 0, (w) => { w.u32(keys.length); for (const k of keys) w.u32(k); });
  const stsc = fullBox('stsc', 0, 0, (w) => { w.u32(1); w.u32(1); w.u32(1); w.u32(1); });
  const stsz = fullBox('stsz', 0, 0, (w) => { w.u32(0); w.u32(samples.length); for (const s of samples) w.u32(s.data.length); });
  const stco = fullBox('stco', 0, 0, (w) => { w.u32(offsets.length); for (const o of offsets) w.u32(o); });
  const stbl = box('stbl', stsd, stts, stss, stsc, stsz, stco);
  const minf = box('minf', vmhd, dinf, stbl);
  const mdia = box('mdia', mdhd, hdlr, minf);
  const trak = box('trak', tkhd, mdia);
  const moov = box('moov', mvhd, trak);

  const out = new Uint8Array(ftyp.length + mdatSize + moov.length);
  out.set(ftyp, 0);
  const dv = new DataView(out.buffer);
  dv.setUint32(ftyp.length, mdatSize);
  out.set([0x6d, 0x64, 0x61, 0x74], ftyp.length + 4); // 'mdat'
  let p = dataStart;
  for (const s of samples) { out.set(s.data, p); p += s.data.length; }
  out.set(moov, p);
  return out;
}
