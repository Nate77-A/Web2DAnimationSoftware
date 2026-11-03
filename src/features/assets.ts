// Bitmap asset import, validation, content-hash dedup, persistence and runtime decode cache.
// Source bytes are persisted immediately; the object model only references assets by id.
import type { Asset } from '../domain/schema';
import { db } from './db';

export const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_BYTES = 30 * 1024 * 1024;
export const MAX_DIMENSION = 8192;

const images = new Map<string, HTMLImageElement>();
const blobs = new Map<string, Blob>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();
let onLoaded: () => void = () => {};

export function setAssetLoadedListener(fn: () => void) { onLoaded = fn; }
export function getAssetImage(id: string): HTMLImageElement | undefined { return images.get(id); }
export function getAssetBlob(id: string): Blob | undefined { return blobs.get(id); }

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Detects MIME from magic bytes; the browser-supplied type is not trusted. */
export function sniffMime(bytes: Uint8Array): Asset['mime'] | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

function decode(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The image could not be decoded.')); };
    img.src = url;
  });
}

export class AssetImportError extends Error {}

/** Validates, hashes and stores an image file. Identical bytes are stored once. */
export async function importImage(file: File | Blob, name: string): Promise<Asset> {
  if (file.size > MAX_BYTES) throw new AssetImportError(`"${name}" is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${MAX_BYTES / 1048576} MB.`);
  const buf = await file.arrayBuffer();
  const mime = sniffMime(new Uint8Array(buf.slice(0, 16)));
  if (!mime) throw new AssetImportError(`"${name}" is not a PNG, JPEG or WebP image.`);
  const blob = new Blob([buf], { type: mime });
  let img: HTMLImageElement;
  try { img = await decode(blob); } catch { throw new AssetImportError(`"${name}" could not be decoded by this browser.`); }
  const width = img.naturalWidth, height = img.naturalHeight;
  if (!width || !height) throw new AssetImportError(`"${name}" has no pixels.`);
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) throw new AssetImportError(`"${name}" is ${width}×${height}; the limit is ${MAX_DIMENSION}px per side.`);
  const hash = await sha256Hex(buf);
  if (!(await db.hasAsset(hash).catch(() => false))) {
    await db.putAsset({ id: hash, blob, mime, width, height, byteLength: buf.byteLength, name });
  }
  images.set(hash, img);
  blobs.set(hash, blob);
  return { id: hash, hash, mime, name: name.slice(0, 260), width, height, byteLength: buf.byteLength };
}

/** Registers bytes from a project file (already validated) without re-validating dimensions. */
export async function registerAssetBytes(asset: Asset, bytes: ArrayBuffer): Promise<void> {
  const blob = new Blob([bytes], { type: asset.mime });
  await db.putAsset({ id: asset.id, blob, mime: asset.mime, width: asset.width, height: asset.height, byteLength: bytes.byteLength, name: asset.name });
  blobs.set(asset.id, blob);
  images.delete(asset.id);
}

/** Ensures all project assets are decoded. Resolves with ids that are missing. */
export async function ensureAssetsLoaded(assets: Asset[]): Promise<string[]> {
  const missing: string[] = [];
  await Promise.all(assets.map(async (a) => {
    if (images.has(a.id)) return;
    let p = pending.get(a.id);
    if (!p) {
      p = (async () => {
        let blob = blobs.get(a.id);
        if (!blob) {
          const rec = await db.getAsset(a.id).catch(() => undefined);
          if (!rec) return null;
          blob = rec.blob;
          blobs.set(a.id, blob);
        }
        try {
          const img = await decode(blob);
          images.set(a.id, img);
          onLoaded();
          return img;
        } catch { return null; }
      })();
      pending.set(a.id, p);
    }
    const img = await p;
    pending.delete(a.id);
    if (!img) missing.push(a.id);
  }));
  return missing;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
