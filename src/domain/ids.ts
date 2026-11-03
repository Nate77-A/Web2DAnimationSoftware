let counter = 0;

/** Collision-resistant id: random prefix plus monotonic counter. */
export function newId(prefix = 'id'): string {
  counter = (counter + 1) % 1679616;
  const rnd = typeof crypto !== 'undefined' && 'getRandomValues' in crypto
    ? Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, '0')).join('')
    : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${rnd}${counter.toString(36)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
