import { randomBytes } from 'crypto'

import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'

// the blockhash constructor and a random key work in @solana/web3.js 1.99 and 3.x
export function transferTx(from: PublicKey): Transaction {
  return new Transaction({
    feePayer: from,
    blockhash: new PublicKey(randomBytes(32)).toBase58(),
    lastValidBlockHeight: 0,
  }).add(
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: new PublicKey(randomBytes(32)),
      lamports: 1,
    }),
  )
}
