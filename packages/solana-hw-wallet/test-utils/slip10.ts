import { createHmac, createPrivateKey, pbkdf2Sync, sign } from 'crypto'

import { Keypair } from '@solana/web3.js'

// Trezor test mnemonic, trezor-suite connect e2e fixtures use it for expected keys and signatures
export const MNEMONIC_ALL = Array(12).fill('all').join(' ')

const HARDENED_OFFSET = 0x80000000
const ED25519_PKCS8_PREFIX = Buffer.from(
  '302e020100300506032b657004220420',
  'hex',
)

export function mnemonicToSeed(mnemonic: string, passphrase = ''): Buffer {
  return pbkdf2Sync(
    mnemonic.normalize('NFKD'),
    ('mnemonic' + passphrase).normalize('NFKD'),
    2048,
    64,
    'sha512',
  )
}

export function deriveKeypair(seed: Buffer, hardenedPath: number[]): Keypair {
  let digest = createHmac('sha512', 'ed25519 seed').update(seed).digest()
  for (const index of hardenedPath) {
    const indexBuffer = Buffer.alloc(4)
    indexBuffer.writeUInt32BE((index | HARDENED_OFFSET) >>> 0)
    digest = createHmac('sha512', digest.subarray(32))
      .update(
        Buffer.concat([Buffer.alloc(1), digest.subarray(0, 32), indexBuffer]),
      )
      .digest()
  }
  return Keypair.fromSeed(digest.subarray(0, 32))
}

export function signEd25519(keypair: Keypair, data: Uint8Array): Buffer {
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      ED25519_PKCS8_PREFIX,
      Buffer.from(keypair.secretKey.subarray(0, 32)),
    ]),
    format: 'der',
    type: 'pkcs8',
  })
  return sign(null, data, privateKey)
}
