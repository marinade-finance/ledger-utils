import {
  SOLANA_ERROR__OFFCHAIN_MESSAGE__MAXIMUM_LENGTH_EXCEEDED,
  isSolanaError,
} from '@solana/errors'
import {
  createKeyPairFromBytes,
  signBytes,
  signatureBytes,
  verifySignature,
} from '@solana/keys'
import {
  getOffchainMessageV0Encoder,
  getOffchainMessageV1Encoder,
  offchainMessageApplicationDomain,
  offchainMessageContentRestrictedAsciiOf1232BytesMax,
  offchainMessageContentUtf8Of1232BytesMax,
  offchainMessageContentUtf8Of65535BytesMax,
} from '@solana/offchain-messages'
import { PublicKey } from '@solana/web3.js'

import type { OffchainMessageV0 } from '@solana/offchain-messages'
import type { Keypair } from '@solana/web3.js'

/**
 * Formats a text message into Solana off-chain message format v0 (signed by Ledger).
 * See https://github.com/solana-labs/solana/blob/master/docs/src/proposals/off-chain-message-signing.md
 *
 * @param message the text message
 * @param applicationDomain 32-byte application identifier as base58 string
 * @param signerPublicKey the public key of the signer
 */
export function formatOffchainMessage(
  message: string,
  applicationDomain: string,
  signerPublicKey: PublicKey,
): Buffer {
  const encode = (offchainMessage: OffchainMessageV0) =>
    Buffer.from(getOffchainMessageV0Encoder().encode(offchainMessage))
  const base = {
    version: 0,
    applicationDomain: offchainMessageApplicationDomain(applicationDomain),
    requiredSignatories: [{ address: signerPublicKey.toBase58() as never }],
  } as const

  try {
    return encode(
      /^[\x20-\x7e]*$/.test(message)
        ? {
            ...base,
            content:
              offchainMessageContentRestrictedAsciiOf1232BytesMax(message),
          }
        : {
            ...base,
            content: offchainMessageContentUtf8Of1232BytesMax(message),
          },
    )
  } catch (e) {
    if (
      !isSolanaError(e, SOLANA_ERROR__OFFCHAIN_MESSAGE__MAXIMUM_LENGTH_EXCEEDED)
    ) {
      throw e
    }
    return encode({
      ...base,
      content: offchainMessageContentUtf8Of65535BytesMax(message),
    })
  }
}

// off-chain message format v1 as signed by Trezor, the format has no application domain
export function formatOffchainMessageV1(
  message: string,
  signers: PublicKey[],
): Buffer {
  const sortedSigners = [...signers].sort((a, b) =>
    Buffer.compare(a.toBuffer(), b.toBuffer()),
  )
  return Buffer.from(
    getOffchainMessageV1Encoder().encode({
      version: 1,
      content: message,
      requiredSignatories: sortedSigners.map(s => ({
        address: s.toBase58() as never,
      })),
    }),
  )
}

/**
 * Signs a Solana off-chain message (v0) with a file-based Keypair.
 * Produces the same signature format as LedgerWallet.signOffchainMessage,
 * verifiable with verifyOffchainMessage.
 *
 * @param message the text message to sign
 * @param keypair the file-based Keypair
 * @param applicationDomain 32-byte application identifier as base58 string
 */
export async function signOffchainMessage(
  message: string,
  keypair: Keypair,
  applicationDomain: string,
): Promise<Buffer> {
  const formatted = formatOffchainMessage(
    message,
    applicationDomain,
    new PublicKey(keypair.publicKey),
  )
  const { privateKey } = await createKeyPairFromBytes(keypair.secretKey)
  const sig = await signBytes(privateKey, formatted)
  return Buffer.from(sig)
}

/**
 * Verifies an Ed25519 signature over a Solana off-chain message (v0).
 * Works with signatures from both LedgerWallet.signOffchainMessage and signOffchainMessage.
 *
 * @param message the text message that was signed
 * @param signature the 64-byte Ed25519 signature
 * @param publicKey the public key of the signer
 * @param applicationDomain 32-byte application identifier as base58 string
 */
export async function verifyOffchainMessage(
  message: string,
  signature: Buffer,
  publicKey: PublicKey,
  applicationDomain: string,
): Promise<boolean> {
  return verifyBytes(
    formatOffchainMessage(message, applicationDomain, publicKey),
    signature,
    publicKey,
  )
}

// verifies signatures of TrezorWallet.signOffchainMessage
export async function verifyOffchainMessageV1(
  message: string,
  signature: Buffer,
  publicKey: PublicKey,
  signers: PublicKey[] = [publicKey],
): Promise<boolean> {
  return verifyBytes(
    formatOffchainMessageV1(message, signers),
    signature,
    publicKey,
  )
}

async function verifyBytes(
  data: Uint8Array,
  signature: Buffer,
  publicKey: PublicKey,
): Promise<boolean> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(publicKey.toBytes()),
    'Ed25519',
    true,
    ['verify'],
  )
  return verifySignature(
    cryptoKey,
    signatureBytes(new Uint8Array(signature)),
    data,
  )
}
