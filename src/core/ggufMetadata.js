import { openSync, readSync, closeSync } from 'node:fs';

export function readGgufContext(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const buffer = Buffer.alloc(4 * 1024 * 1024);
    const size = readSync(fd, buffer, 0, buffer.length, 0);
    const b = buffer.subarray(0, size);
    if (b.toString('ascii', 0, 4) !== 'GGUF' || b.length < 24 || ![2, 3].includes(b.readUInt32LE(4))) return null;
    let p = 24;
    const u64 = () => { const v = Number(b.readBigUInt64LE(p)); p += 8; if (!Number.isSafeInteger(v) || v < 0) throw new Error('Invalid size'); return v; };
    const string = () => { const n = u64(); if (p + n > b.length) throw new Error('Header limit'); const v = b.toString('utf8', p, p + n); p += n; return v; };
    const widths = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
    const skip = (type, depth = 0) => {
      if (depth > 2) throw new Error('Nested metadata limit');
      if (type === 8) { const n = u64(); p += n; }
      else if (type === 9) { const t = b.readUInt32LE(p); p += 4; const n = u64(); if (n > 1000000) throw new Error('Array limit'); if (widths[t]) p += n * widths[t]; else for (let i = 0; i < n; i++) skip(t, depth + 1); }
      else if (widths[type]) p += widths[type];
      else throw new Error('Unknown metadata type');
      if (p > b.length) throw new Error('Header limit');
    };
    const entries = Number(b.readBigUInt64LE(16));
    if (!Number.isSafeInteger(entries) || entries > 100000) return null;
    for (let i = 0; i < entries; i++) {
      const key = string(); const type = b.readUInt32LE(p); p += 4;
      if (/\.context_length$/.test(key) && [4, 10].includes(type)) {
        const value = type === 4 ? b.readUInt32LE(p) : u64();
        return value > 0 && value <= 100000000 ? value : null;
      }
      skip(type);
    }
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
  return null;
}
