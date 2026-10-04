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

export function serializeTransactionMessage(
  tx: Transaction | VersionedTransaction,
): Buffer {
  // no instanceof, the transaction may come from a different @solana/web3.js copy
  return 'serializeMessage' in tx
    ? tx.serializeMessage()
    : Buffer.from(tx.message.serialize())
}
