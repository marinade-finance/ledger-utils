import { Keypair } from '@solana/web3.js'

import {
  formatOffchainMessage,
  signOffchainMessage,
  verifyOffchainMessage,
} from '../src/ledger'

// A fixed application domain for tests (any valid base58 32-byte value works)
const APP_DOMAIN = '11111111111111111111111111111111'

describe('formatOffchainMessage', () => {
  const signer = Keypair.generate()

  it('formats restricted ASCII message (format 0)', () => {
    const msg = 'Hello, world!'
    const buf = formatOffchainMessage(msg, APP_DOMAIN, signer.publicKey)

    // header prefix: \xffsolana offchain (16 bytes)
    expect(buf.subarray(0, 16)).toEqual(
      Buffer.from('\xffsolana offchain', 'binary'),
    )
    expect(buf.readUInt8(16)).toBe(0) // version
    // 17..48: applicationDomain (32 bytes)
    expect(buf.readUInt8(49)).toBe(0) // format: RESTRICTED_ASCII
  })

  it('formats UTF-8 message <=1232 bytes as format 1', () => {
    const msg = 'Ahoj sv\u011bte! \u{1F600}'
    const buf = formatOffchainMessage(msg, APP_DOMAIN, signer.publicKey)

    expect(buf.readUInt8(49)).toBe(1) // format: UTF8_1232_BYTES_MAX
  })

  it('formats UTF-8 message >1232 bytes as format 2', () => {
    const msg = '\u011b'.repeat(1233)
    const buf = formatOffchainMessage(msg, APP_DOMAIN, signer.publicKey)

    expect(buf.readUInt8(49)).toBe(2) // format: UTF8_65535_BYTES_MAX
  })
})

describe('formatOffchainMessage cross-verification with @solana/offchain-messages', () => {
  it('produces identical bytes as the library encoder for ASCII', async () => {
    const {
      getOffchainMessageV0Encoder,
      offchainMessageApplicationDomain,
      offchainMessageContentRestrictedAsciiOf1232BytesMax,
    } = await import('@solana/offchain-messages')

    const signer = Keypair.generate()
    const msg = 'Hello, world!'

    const ourBytes = formatOffchainMessage(msg, APP_DOMAIN, signer.publicKey)

    const encoder = getOffchainMessageV0Encoder()
    const libraryBytes = Buffer.from(
      encoder.encode({
        version: 0,
        applicationDomain: offchainMessageApplicationDomain(APP_DOMAIN),
        content: offchainMessageContentRestrictedAsciiOf1232BytesMax(msg),
        requiredSignatories: [
          { address: signer.publicKey.toBase58() as never },
        ],
      }),
    )

    expect(ourBytes).toEqual(libraryBytes)
  })

  it('produces identical bytes as the library encoder for UTF-8', async () => {
    const {
      getOffchainMessageV0Encoder,
      offchainMessageApplicationDomain,
      offchainMessageContentUtf8Of1232BytesMax,
    } = await import('@solana/offchain-messages')

    const signer = Keypair.generate()
    const msg = 'Ahoj sv\u011bte! \u{1F600}'

    const ourBytes = formatOffchainMessage(msg, APP_DOMAIN, signer.publicKey)

    const encoder = getOffchainMessageV0Encoder()
    const libraryBytes = Buffer.from(
      encoder.encode({
        version: 0,
        applicationDomain: offchainMessageApplicationDomain(APP_DOMAIN),
        content: offchainMessageContentUtf8Of1232BytesMax(msg),
        requiredSignatories: [
          { address: signer.publicKey.toBase58() as never },
        ],
      }),
    )

    expect(ourBytes).toEqual(libraryBytes)
  })
})

describe('signOffchainMessage and verifyOffchainMessage', () => {
  it('sign and verify ASCII message', async () => {
    const keypair = Keypair.generate()
    const msg = 'Hello, Solana offchain!'

    const signature = await signOffchainMessage(msg, keypair, APP_DOMAIN)
    expect(signature.length).toBe(64)
    expect(
      await verifyOffchainMessage(
        msg,
        signature,
        keypair.publicKey,
        APP_DOMAIN,
      ),
    ).toBe(true)
  })

  it('sign and verify UTF-8 message', async () => {
    const keypair = Keypair.generate()
    const msg = 'Ahoj sv\u011bte! \u{1F600}'

    const signature = await signOffchainMessage(msg, keypair, APP_DOMAIN)
    expect(
      await verifyOffchainMessage(
        msg,
        signature,
        keypair.publicKey,
        APP_DOMAIN,
      ),
    ).toBe(true)
  })

  it('rejects tampered message', async () => {
    const keypair = Keypair.generate()

    const signature = await signOffchainMessage(
      'Hello, Solana offchain!',
      keypair,
      APP_DOMAIN,
    )
    expect(
      await verifyOffchainMessage(
        'Hello, Solana offchain?',
        signature,
        keypair.publicKey,
        APP_DOMAIN,
      ),
    ).toBe(false)
  })

  it('rejects wrong public key', async () => {
    const signer = Keypair.generate()
    const other = Keypair.generate()
    const msg = 'test message'

    const signature = await signOffchainMessage(msg, signer, APP_DOMAIN)
    expect(
      await verifyOffchainMessage(msg, signature, other.publicKey, APP_DOMAIN),
    ).toBe(false)
  })

  it('rejects wrong application domain', async () => {
    const keypair = Keypair.generate()
    const msg = 'test message'
    const otherDomain = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

    const signature = await signOffchainMessage(msg, keypair, APP_DOMAIN)
    expect(
      await verifyOffchainMessage(
        msg,
        signature,
        keypair.publicKey,
        otherDomain,
      ),
    ).toBe(false)
  })
})
