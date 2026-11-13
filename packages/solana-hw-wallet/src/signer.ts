import { getPublicKeyFromAddress } from '@solana/addresses'
import { verifySignature } from '@solana/keys'

import type { SignatureDictionary, SignerConfig } from './wallet'
import type { Address } from '@solana/addresses'
import type { SignatureBytes } from '@solana/keys'

// devices sign legacy and v0 only, see LedgerHQ/app-solana#248 and trezor/trezor-firmware#7865
export function assertTransactionMessageVersion(
  messageBytes: ArrayLike<number>,
  device: string,
): void {
  const prefix = messageBytes[0] ?? 0
  if ((prefix & 0x80) !== 0 && (prefix & 0x7f) >= 1) {
    throw new Error(
      `Transaction version ${prefix & 0x7f} is not supported by ${device}, ` +
        'sign a legacy or v0 transaction instead',
    )
  }
}

// a device re-plugged with another seed after the wallet opened signs with another key
export async function assertSignedBy(
  address: Address,
  bytes: Uint8Array,
  signature: SignatureBytes,
  device: string,
): Promise<SignatureBytes> {
  if (
    !(await verifySignature(
      await getPublicKeyFromAddress(address),
      signature,
      bytes,
    ))
  ) {
    throw new Error(
      `${device} signed with another key than ${address}, check the connected device`,
    )
  }
  return signature
}

// one device signs one request at a time, the abort signal is checked before each device call
export async function signEach(
  address: Address,
  items: readonly ArrayLike<number>[],
  config: SignerConfig | undefined,
  sign: (bytes: Uint8Array) => Promise<SignatureBytes>,
): Promise<readonly SignatureDictionary[]> {
  const signatures: SignatureDictionary[] = []
  for (const item of items) {
    config?.abortSignal?.throwIfAborted()
    signatures.push({ [address]: await sign(Uint8Array.from(item)) })
  }
  return signatures
}
