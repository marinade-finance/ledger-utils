import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'

import {
  MNEMONIC_ALL,
  deriveKeypair,
  mnemonicToSeed,
} from '../test-utils/slip10'

import type { TransactionInstruction } from '@solana/web3.js'

export const ALL_0_0 = '14CCvQzQzHCVgZM3j9soPnXuJXh1RmCfwLVUcdfbZVBS'
export const KEY_0_0 = deriveKeypair(
  mnemonicToSeed(MNEMONIC_ALL),
  [44, 501, 0, 0],
)

export function transfer(from: PublicKey): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: from,
    toPubkey: Keypair.generate().publicKey,
    lamports: 1,
  })
}

export function legacyMessage(instruction: TransactionInstruction): Uint8Array {
  return new Transaction({
    feePayer: new PublicKey(ALL_0_0),
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  })
    .add(instruction)
    .serializeMessage()
}
