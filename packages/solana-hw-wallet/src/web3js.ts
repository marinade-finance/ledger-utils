import { serializeTransactionMessage } from './wallet'

import type { HardwareWallet, Wallet } from './wallet'
import type * as Web3Module from '@solana/web3.js'
import type { Transaction, VersionedTransaction } from '@solana/web3.js'

// Anchor compatible Wallet over a hardware wallet, @solana/web3.js is loaded only here
export async function toWeb3Wallet(wallet: HardwareWallet): Promise<Wallet> {
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
    signTransaction,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(
      txs: T[],
    ): Promise<T[]> => {
      const signedTxs: T[] = []
      for (const tx of txs) {
        signedTxs.push(await signTransaction(tx))
      }
      return signedTxs
    },
  }
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
