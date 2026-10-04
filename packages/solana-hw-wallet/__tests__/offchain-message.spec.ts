import { Keypair, PublicKey } from '@solana/web3.js'

import {
  formatOffchainMessage,
  formatOffchainMessageV1,
  signOffchainMessage,
  verifyOffchainMessage,
  verifyOffchainMessageV1,
} from '../src/offchain'

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

  it('switches to format 2 when the whole message exceeds 1232 bytes', () => {
    const fits = 'a'.repeat(1147)
    const exceeds = 'a'.repeat(1148)
    expect(
      formatOffchainMessage(fits, APP_DOMAIN, signer.publicKey),
    ).toHaveLength(1232)
    expect(
      formatOffchainMessage(fits, APP_DOMAIN, signer.publicKey).readUInt8(49),
    ).toBe(0)
    expect(
      formatOffchainMessage(exceeds, APP_DOMAIN, signer.publicKey).readUInt8(
        49,
      ),
    ).toBe(2)
    expect(
      formatOffchainMessage(
        'ě'.repeat(574),
        APP_DOMAIN,
        signer.publicKey,
      ).readUInt8(49),
    ).toBe(2)
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

// expected values from trezor-suite connect-core e2e fixtures solanaSignMessage (mnemonic "all" x12)
describe('off-chain message v1 against Trezor firmware fixtures', () => {
  const signer = new PublicKey('14CCvQzQzHCVgZM3j9soPnXuJXh1RmCfwLVUcdfbZVBS')
  const coSigner = new PublicKey('7v91N7iZ9mNicL8WfG6cgSCKyRXydQjLh6UYBWwm6y1Q')
  const accountKey = new PublicKey(
    '4UR47Kp4FxGJiJZZGSPAzXqRgMmZ27oVfGhHoLmcHakE',
  )
  const longMessage =
    'This is a longer test message that should be chunked across multiple display screens on the device'

  it('formats the same envelope as Trezor signs', () => {
    expect(
      formatOffchainMessageV1('Hello, Trezor!', [signer]).toString('hex'),
    ).toEqual(
      'ff736f6c616e61206f6666636861696e010100d1699dcb1811b50bb0055f13044463128242e37a463b52f6c97a1f6eef88ad48656c6c6f2c205472657a6f7221',
    )
    expect(
      formatOffchainMessageV1(longMessage, [coSigner, signer]).toString('hex'),
    ).toEqual(
      'ff736f6c616e61206f6666636861696e010200d1699dcb1811b50bb0055f13044463128242e37a463b52f6c97a1f6eef88ad66c2f508c9c555cacc9fb26d88e88dd54e210bb5a8bce5687f60d7e75c4cd07f546869732069732061206c6f6e6765722074657374206d65737361676520746861742073686f756c64206265206368756e6b6564206163726f7373206d756c7469706c6520646973706c61792073637265656e73206f6e2074686520646576696365',
    )
  })

  it('verifies Trezor signatures', async () => {
    expect(
      await verifyOffchainMessageV1(
        'Hello, Trezor!',
        Buffer.from(
          'f2580d7f82bf2f9737925e7817d5b04cfe8b5e9b1f3c138517a9c55f2bb1f95524db937ec2a1dfebf67a1dc3ab27ef80629854ee2af5cb0ceb40568bc1bdb503',
          'hex',
        ),
        signer,
      ),
    ).toBe(true)
    expect(
      await verifyOffchainMessageV1(
        'Test message',
        Buffer.from(
          '8b68c182627e84a0919372d809089e3a516de7ed90b1764aafdd995ef2fd39874929a5205d4e4eb360d260073e3316959571a5baf32a58f82bdbff83253abf06',
          'hex',
        ),
        accountKey,
      ),
    ).toBe(true)
    expect(
      await verifyOffchainMessageV1(
        longMessage,
        Buffer.from(
          '2dfa811d310f8eedcd945cbfcf3edd1abe319f051c3f9a111a75ee2280070a74b8635084fec9a5c629c65d752bc8223e735056f30764f8685c153160da2a1107',
          'hex',
        ),
        signer,
        [signer, coSigner],
      ),
    ).toBe(true)
  })

  it('rejects Trezor signature for a different message or signers', async () => {
    const signature = Buffer.from(
      'f2580d7f82bf2f9737925e7817d5b04cfe8b5e9b1f3c138517a9c55f2bb1f95524db937ec2a1dfebf67a1dc3ab27ef80629854ee2af5cb0ceb40568bc1bdb503',
      'hex',
    )
    expect(
      await verifyOffchainMessageV1('Hello, Trezor?', signature, signer),
    ).toBe(false)
    expect(
      await verifyOffchainMessageV1('Hello, Trezor!', signature, signer, [
        signer,
        coSigner,
      ]),
    ).toBe(false)
    expect(
      await verifyOffchainMessage(
        'Hello, Trezor!',
        signature,
        signer,
        APP_DOMAIN,
      ),
    ).toBe(false)
  })
})
