/**
 * Decrypting a private file's actual bytes for preview/download.
 *
 * A private file's *data* transaction carries its own `Cipher-IV` tag, separate from the
 * metadata transaction's — the two are encrypted independently (metadata under the file key,
 * data under the same file key but a different IV). This is looked up lazily, only when a file is
 * actually opened, not for every file in a listing: most files in a browsed folder are never
 * previewed, so eagerly fetching every data transaction's tags would be pure waste.
 */

import { ArweaveGql, DEFAULT_DATA_GATEWAYS, RESILIENT_DATA_GATEWAYS } from '../gql';
import { fetchBinaryBody } from '../metadata';
import { tagMap, Tag, type FileEntity } from '../types';
import { decryptBytes, DecryptionFailedError } from './cipher';
import type { DerivedKey } from './kdf';

export class FileDataUnavailableError extends Error {}

interface RawTx {
  transaction: { tags: { name: string; value: string }[] } | null;
}

/**
 * A transaction's tags never change once mined, so a lookup is safe to cache forever — and worth
 * it: `RowThumbnail` calls this once per visible private image, so revisiting a folder (or two
 * different rows referencing the same file, e.g. a thumbnail and its own Preview) would otherwise
 * repeat the exact same GraphQL round trip every time. Caching the in-flight *promise*, not just
 * the resolved value, also collapses concurrent duplicate lookups (several rows mounting at once
 * for the same file) into a single request instead of one each.
 */
const tagsCache = new Map<string, Promise<Map<string, string>>>();

/** Look up a transaction's own tags directly by ID — a single-transaction point query. */
function fetchTags(gql: ArweaveGql, txId: string): Promise<Map<string, string>> {
  const cached = tagsCache.get(txId);
  if (cached) return cached;

  const promise = (async () => {
    const data = await gql.query<RawTx>(`{transaction(id:${JSON.stringify(txId)}){tags{name value}}}`);
    if (!data.transaction) throw new FileDataUnavailableError(`Transaction ${txId} not found.`);
    return tagMap(data.transaction.tags);
  })();
  // Don't let a failed lookup poison the cache forever — a transient network error should be
  // retried on the next call, not remembered as permanent.
  promise.catch(() => tagsCache.delete(txId));
  tagsCache.set(txId, promise);
  return promise;
}

/**
 * Fetch and decrypt a private file's data transaction, returning a `Blob` ready for
 * `URL.createObjectURL`. Throws `DecryptionFailedError` if the file key is wrong (shouldn't
 * happen if the drive password was already verified against the drive's own metadata, but the
 * file key is a distinct derivation, so this stays a real possibility worth a real error).
 *
 * `RESILIENT_DATA_GATEWAYS`, not the single default: this is a one-shot fetch for the *one* file
 * a user just clicked to view or download, the same shape as unlocking a drive
 * (`privateDrives.ts`) — correctness matters more than the extra latency a second gateway can add,
 * unlike a thumbnail fetched per-row at list scale (`fetchAndDecryptThumbnail` below, deliberately
 * left on the fast single gateway).
 */
export async function fetchAndDecryptFileData(
  file: FileEntity,
  fileKey: DerivedKey,
  gql: ArweaveGql = new ArweaveGql(),
): Promise<Blob> {
  if (!file.dataTxId) throw new FileDataUnavailableError('This file has no data transaction.');

  const tags = await fetchTags(gql, file.dataTxId);
  const cipherIv = tags.get(Tag.cipherIv);
  if (!cipherIv) throw new FileDataUnavailableError('Data transaction is missing its Cipher-IV tag.');

  const ciphertext = await fetchBinaryBody(file.dataTxId, { gateways: RESILIENT_DATA_GATEWAYS });
  const plaintext = await decryptBytes(cipherIv, fileKey, ciphertext);
  return new Blob([plaintext], { type: file.dataContentType || 'application/octet-stream' });
}

/**
 * Decrypted thumbnails, keyed by the thumbnail's own txId (globally unique on Arweave, so this
 * never collides across drives or files). Same reasoning as `tagsCache`: `RowThumbnail` re-mounts
 * on every folder revisit, and without this each one re-fetches *and* re-decrypts from scratch —
 * real, repeated work for something whose result can never change once the transaction exists.
 * Unbounded is fine here: thumbnails are deliberately tiny (that's the point of a thumbnail), so a
 * session would need to browse an enormous number of distinct private images before this cache's
 * memory use became worth worrying about.
 */
const thumbnailCache = new Map<string, Promise<Blob>>();

/**
 * Fetch and decrypt a private file's *thumbnail* — same shape as `fetchAndDecryptFileData`, but
 * pointed at the thumbnail's own data transaction and decrypted with the same file key as the
 * main data (ArDrive doesn't derive a separate key for thumbnails; verified against
 * `ardrive-web`'s `ThumbnailRepository`). Content-Type is hardcoded to `image/jpeg` — ArDrive
 * always generates JPEG thumbnails and the `Variant` JSON itself carries no content-type field.
 */
export function fetchAndDecryptThumbnail(
  thumbnailTxId: string,
  fileKey: DerivedKey,
  gql: ArweaveGql = new ArweaveGql(),
): Promise<Blob> {
  const cached = thumbnailCache.get(thumbnailTxId);
  if (cached) return cached;

  const promise = (async () => {
    const tags = await fetchTags(gql, thumbnailTxId);
    const cipherIv = tags.get(Tag.cipherIv);
    if (!cipherIv) throw new FileDataUnavailableError('Thumbnail transaction is missing its Cipher-IV tag.');

    const ciphertext = await fetchBinaryBody(thumbnailTxId, { gateways: DEFAULT_DATA_GATEWAYS });
    const plaintext = await decryptBytes(cipherIv, fileKey, ciphertext);
    return new Blob([plaintext], { type: 'image/jpeg' });
  })();
  promise.catch(() => thumbnailCache.delete(thumbnailTxId));
  thumbnailCache.set(thumbnailTxId, promise);
  return promise;
}

export { DecryptionFailedError };
