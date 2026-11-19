import type { HardwareWallet, Wallet } from './wallet'
import type * as Web3Module from '@solana/web3.js'
import type { Transaction, VersionedTransaction } from '@solana/web3.js'

/**
 * Anchor compatible Wallet that also carries the hardware wallet it signs with.
 */
export type Web3HardwareWallet = Wallet & {
  readonly hardwareWallet: HardwareWallet
}

// Anchor compatible Wallet over a hardware wallet, @solana/web3.js is loaded only here
export async function toWeb3Wallet(
  wallet: HardwareWallet,
): Promise<Web3HardwareWallet> {
  const { PublicKey } = await loadWeb3()
  const publicKey = new PublicKey(wallet.address)
  const signTransaction = async <T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> => {
    const signature = await wallet.signTransactionMessage(
      serializeTransactionMessage(tx),
    )
    tx.addSignature(publicKey, Buffer.from(signature))
    return tx
  }
  return {
    publicKey,
    hardwareWallet: wallet,
    signTransaction,
    // signTransactions refuses an unsupported version before the first device call of the batch
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(
      txs: T[],
    ): Promise<T[]> => {
      const signatures = await wallet.signTransactions(
        txs.map(tx => ({ messageBytes: serializeTransactionMessage(tx) })),
      )
      txs.forEach((tx, i) =>
        tx.addSignature(
          publicKey,
          Buffer.from(signatures[i]?.[wallet.address] ?? []),
        ),
      )
      return txs
    },
  }
}

function serializeTransactionMessage(
  tx: Transaction | VersionedTransaction,
): Uint8Array {
  // no instanceof, the transaction may come from a different @solana/web3.js copy
  return 'serializeMessage' in tx
    ? tx.serializeMessage()
    : tx.message.serialize()
}

export async function loadWeb3(): Promise<typeof Web3Module> {
  try {
    return await import('@solana/web3.js')
  } catch (e) {
    throw new Error(
      'Anchor compatible Wallet requires package @solana/web3.js to be installed',
      { cause: e },
    )
  }
}
