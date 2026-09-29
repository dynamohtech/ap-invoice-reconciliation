import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Local disk for local testing and small-scale production. The function
// signatures here are the seam to swap in S3 / Azure Blob / MinIO later
// — nothing outside this
// file should know or care where bytes actually live. Store the returned
// `key`, never a URL: URLs break the moment you change storage backends,
// keys don't.

const STORAGE_ROOT = process.env.FILE_STORAGE_ROOT || path.resolve(process.cwd(), 'storage', 'invoices');

export async function saveFile(buffer, originalName) {
  const datePart = new Date().toISOString().slice(0, 7); // YYYY-MM — keeps any one folder from holding 10,000+ files
  const dir = path.join(STORAGE_ROOT, datePart);
  await fs.mkdir(dir, { recursive: true });

  const ext = path.extname(originalName || '') || '';
  const key = path.join(datePart, `${crypto.randomUUID()}${ext}`);
  await fs.writeFile(path.join(STORAGE_ROOT, key), buffer);
  return key;
}

export async function readFile(key) {
  // Guard against path traversal — a key is always a value WE generated in
  // saveFile, but this makes the assumption load-bearing rather than implicit.
  const resolved = path.resolve(STORAGE_ROOT, key);
  if (!resolved.startsWith(path.resolve(STORAGE_ROOT))) {
    throw new Error('Invalid storage key.');
  }
  return fs.readFile(resolved);
}

export function storageRoot() {
  return STORAGE_ROOT;
}
