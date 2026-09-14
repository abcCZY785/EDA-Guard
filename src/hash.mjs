import { createHash } from 'node:crypto';

/**
 * Convert a value to a deterministic JSON-safe value. Objects are key sorted;
 * arrays are deliberately not sorted here because callers must choose the
 * domain-specific identity order before hashing.
 */
export function normalizeForJson(value) {
  if (value === undefined) return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(normalizeForJson);
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = normalizeForJson(value[key]);
    return out;
  }
  return String(value);
}

export function stableStringify(value) {
  return JSON.stringify(normalizeForJson(value));
}

export function sha256Text(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function hashObject(value) {
  return sha256Text(stableStringify(value));
}

export function sortByKeys(items, keys) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    for (const key of keys) {
      const read = (obj) => key.split('.').reduce((acc, part) => acc?.[part], obj);
      const av = read(a) ?? '';
      const bv = read(b) ?? '';
      const as = typeof av === 'number' ? av : String(av);
      const bs = typeof bv === 'number' ? bv : String(bv);
      if (as < bs) return -1;
      if (as > bs) return 1;
    }
    return 0;
  });
}
