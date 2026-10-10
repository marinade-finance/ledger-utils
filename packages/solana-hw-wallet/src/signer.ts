import type { SignatureDictionary, SignerConfig } from './wallet'
import type { Address } from '@solana/addresses'
import type { SignatureBytes } from '@solana/keys'

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
