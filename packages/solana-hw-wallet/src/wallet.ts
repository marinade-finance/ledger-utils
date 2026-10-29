import { address } from '@solana/addresses'

import type { Address } from '@solana/addresses'
import type { SignatureBytes } from '@solana/keys'
import type {
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js'

/**
 * Wallet interface for objects that can be used to sign provider transactions.
 * The interface is compatible with @coral-xyz/anchor/dist/cjs/provider in version 0.28.0
 * See https://github.com/coral-xyz/anchor/blob/v0.28.0/ts/packages/anchor/src/provider.ts#L344
 */
export interface Wallet {
  signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T>
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]>
  publicKey: PublicKey
}

// structurally the kit @solana/signers SignatureDictionary and signer config
export type SignatureDictionary = Readonly<Record<Address, SignatureBytes>>
export type SignerConfig = { abortSignal?: AbortSignal }

/**
 * A key on a Ledger or Trezor device. It is a kit TransactionPartialSigner and MessagePartialSigner.
 */
export interface HardwareWallet {
  readonly address: Address
  readonly derivationPath: string
  signTransactionMessage(messageBytes: Uint8Array): Promise<SignatureBytes>
  signTransactions(
    transactions: readonly { messageBytes: ArrayLike<number> }[],
    config?: SignerConfig,
  ): Promise<readonly SignatureDictionary[]>
  signMessages(
    messages: readonly { content: ArrayLike<number> }[],
    config?: SignerConfig,
  ): Promise<readonly SignatureDictionary[]>
  confirmPublicKey(): Promise<Address>
}

export type AddressInput = string | { toBase58(): string }

export function toAddress(input: AddressInput): Address {
  return address(typeof input === 'string' ? input : input.toBase58())
}

export function serializeTransactionMessage(
  tx: Transaction | VersionedTransaction,
): Buffer {
  // no instanceof, the transaction may come from a different @solana/web3.js copy
  return 'serializeMessage' in tx
    ? tx.serializeMessage()
    : Buffer.from(tx.message.serialize())
}
