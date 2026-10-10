import { getAddressEncoder, getAddressFromPublicKey } from '@solana/addresses'
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

import { toAddress } from './wallet'

import type { AddressInput } from './wallet'
import type { OffchainMessageV0 } from '@solana/offchain-messages'

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
  signerPublicKey: AddressInput,
): Buffer {
  const encode = (offchainMessage: OffchainMessageV0) =>
    Buffer.from(getOffchainMessageV0Encoder().encode(offchainMessage))
  const base = {
    version: 0,
    applicationDomain: offchainMessageApplicationDomain(applicationDomain),
    requiredSignatories: [{ address: toAddress(signerPublicKey) }],
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
  signers: AddressInput[],
): Buffer {
  const encoder = getAddressEncoder()
  const sortedSigners = signers
    .map(s => toAddress(s))
    .sort((a, b) =>
      Buffer.compare(
        Buffer.from(encoder.encode(a)),
        Buffer.from(encoder.encode(b)),
      ),
    )
  return Buffer.from(
    getOffchainMessageV1Encoder().encode({
      version: 1,
      content: message,
      requiredSignatories: sortedSigners.map(address => ({ address })),
    }),
  )
}

/**
 * Signs a Solana off-chain message (v0) with a software key.
 * Produces the same signature format as LedgerWallet.signOffchainMessage,
 * verifiable with verifyOffchainMessage.
 *
 * @param message the text message to sign
 * @param keypair 64-byte secret key holder (e.g. web3.js Keypair) or a kit CryptoKeyPair
 * @param applicationDomain 32-byte application identifier as base58 string
 */
export async function signOffchainMessage(
  message: string,
  keypair: { secretKey: Uint8Array } | CryptoKeyPair,
  applicationDomain: string,
): Promise<Buffer> {
  const keyPair =
    'secretKey' in keypair
      ? await createKeyPairFromBytes(keypair.secretKey)
      : keypair
  const formatted = formatOffchainMessage(
    message,
    applicationDomain,
    await getAddressFromPublicKey(keyPair.publicKey),
  )
  return Buffer.from(await signBytes(keyPair.privateKey, formatted))
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
  publicKey: AddressInput,
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
  publicKey: AddressInput,
  signers: AddressInput[] = [publicKey],
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
  publicKey: AddressInput,
): Promise<boolean> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(getAddressEncoder().encode(toAddress(publicKey))),
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
