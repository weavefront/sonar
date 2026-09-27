import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { v2Signature } from './signature';
import { signingKeyFor } from './kdf';

const DRIVE_ID = '707bd1f5-5ef4-4649-a64e-0acfed5835f0';

// arbundles' ArweaveSigner requires a real 4096-bit key (512-byte owner), same as a real wallet.
let jwk: JsonWebKey;
let signedDataItemRaw: Uint8Array;
let expectedSignature: Uint8Array;

beforeAll(async () => {
  const { privateKey } = await crypto.subtle.generateKey(
    { name: 'RSA-PSS', modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  jwk = await crypto.subtle.exportKey('jwk', privateKey);

  // Build the exact DataItem ArDrive builds (data = utf8("drive")||driveIdBytes, one Action tag),
  // signed deterministically at saltLength 0 — this stands in for what a real wallet returns.
  const { createData, ArweaveSigner } = await import('@dha-team/arbundles');
  const signer = new ArweaveSigner(jwk as never);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['sign']);
  (signer as unknown as { sign: (m: Uint8Array) => Promise<Uint8Array> }).sign = async (m) =>
    new Uint8Array(await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 0 }, key, m as BufferSource));

  const item = createData(signingKeyFor(DRIVE_ID), signer, {
    tags: [{ name: 'Action', value: 'Drive-Signature-V2' }],
  });
  await item.sign(signer);
  signedDataItemRaw = new Uint8Array(item.getRaw());
  expectedSignature = new Uint8Array(item.rawSignature);
});

const OWNER_PUBLIC_KEY = 'a'.repeat(683); // shape of a real base64url 4096-bit modulus

function stubWander(signDataItem: (...args: unknown[]) => Promise<ArrayBuffer | Uint8Array>) {
  (globalThis as { window?: unknown }).window = {
    arweaveWallet: { signDataItem, getActivePublicKey: async () => OWNER_PUBLIC_KEY },
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const wanderWallet = { mode: 'wander', canSign: true, jwk: null } as const;

describe('v2Signature (wander)', () => {
  it('takes the signature from bytes 2..514 of the signed DataItem', async () => {
    stubWander(async () => signedDataItemRaw);
    const sig = await v2Signature({ ...wanderWallet }, DRIVE_ID);
    expect(sig.length).toBe(512);
    expect([...sig]).toEqual([...expectedSignature]);
  });

  it('handles an ArrayBuffer return, which is what Wander actually gives back', async () => {
    // An ArrayBuffer has `byteLength`, not `length` — reading `.length` yields undefined. That is
    // precisely what hid the shape of this bug in the first diagnostic trace.
    stubWander(async () => signedDataItemRaw.buffer.slice(0) as ArrayBuffer);
    const sig = await v2Signature({ ...wanderWallet }, DRIVE_ID);
    expect([...sig]).toEqual([...expectedSignature]);
  });

  it('sends owner, target, anchor, data and tags exactly as ArDrive does — all signed deep-hash input', async () => {
    interface SignedRequest {
      owner: string;
      target: string;
      anchor: string;
      data: Uint8Array;
      tags: { name: string; value: string }[];
    }
    const signDataItem = vi.fn(async (..._args: unknown[]) => signedDataItemRaw);
    stubWander(signDataItem);
    await v2Signature({ ...wanderWallet }, DRIVE_ID);

    const [dataItem, options] = signDataItem.mock.calls[0] as [SignedRequest, { saltLength: number }];
    expect([...dataItem.data]).toEqual([...signingKeyFor(DRIVE_ID)]);
    expect(dataItem.tags).toEqual([{ name: 'Action', value: 'Drive-Signature-V2' }]);
    // `owner` is the field whose omission actually broke real drives: the wallet hashes the item
    // as given, so leaving it out produces a different signature — and so a different drive key —
    // than ArDrive derives for the same wallet and password.
    expect(dataItem.owner).toBe(OWNER_PUBLIC_KEY);
    // Explicitly empty, never absent: a missing anchor is conventionally randomised.
    expect(dataItem.target).toBe('');
    expect(dataItem.anchor).toBe('');
    // RSA-PSS is deterministic only at salt length 0, and this is the exact options shape the
    // reference implementation sends.
    expect(options).toEqual({ saltLength: 0 });
  });

  it('rejects a response too short to contain a signature instead of deriving a wrong key', async () => {
    stubWander(async () => new Uint8Array(10));
    await expect(v2Signature({ ...wanderWallet }, DRIVE_ID)).rejects.toThrow(/too short/i);
  });
});
