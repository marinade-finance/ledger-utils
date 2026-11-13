import {
  createHmac,
  createPrivateKey,
  createPublicKey,
  pbkdf2Sync,
  sign,
} from 'crypto'

import { getAddressDecoder } from '@solana/addresses'

import type { Address } from '@solana/addresses'

// Trezor test mnemonic, trezor-suite connect e2e fixtures use it for expected keys and signatures
export const MNEMONIC_ALL = Array(12).fill('all').join(' ')

const HARDENED_OFFSET = 0x80000000
const ED25519_PKCS8_PREFIX = Buffer.from(
  '302e020100300506032b657004220420',
  'hex',
)

export type Slip10Keypair = {
  // 64 bytes: private seed + public key, same layout as web3.js Keypair.secretKey
  secretKey: Uint8Array
  publicKey: Uint8Array
  address: Address
}

export function mnemonicToSeed(mnemonic: string, passphrase = ''): Buffer {
  return pbkdf2Sync(
    mnemonic.normalize('NFKD'),
    ('mnemonic' + passphrase).normalize('NFKD'),
    2048,
    64,
    'sha512',
  )
}

export function deriveKeypair(
  seed: Buffer,
  hardenedPath: number[],
): Slip10Keypair {
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
  const privateSeed = digest.subarray(0, 32)
  const publicKey = new Uint8Array(
    createPublicKey(toPrivateKey(privateSeed))
      .export({ format: 'der', type: 'spki' })
      .subarray(-32),
  )
  return {
    secretKey: new Uint8Array(Buffer.concat([privateSeed, publicKey])),
    publicKey,
    address: getAddressDecoder().decode(publicKey),
  }
}

export function signEd25519(keypair: Slip10Keypair, data: Uint8Array): Buffer {
  return sign(null, data, toPrivateKey(keypair.secretKey.subarray(0, 32)))
}

function toPrivateKey(privateSeed: Uint8Array) {
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, privateSeed]),
    format: 'der',
    type: 'pkcs8',
  })
}
