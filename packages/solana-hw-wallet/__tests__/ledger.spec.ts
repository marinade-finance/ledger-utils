import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'

import { LedgerWallet } from '../src/ledger'
import { verifyOffchainMessage } from '../src/offchain'
import { FakeLedgerTransport } from '../test-utils/fake-ledger'
import {
  MNEMONIC_ALL,
  deriveKeypair,
  mnemonicToSeed,
} from '../test-utils/slip10'

const mockLedgerDevices = new Map<string, FakeLedgerTransport>()
jest.mock('@ledgerhq/hw-transport-node-hid-noevents', () => ({
  __esModule: true,
  getDevices: () => [...mockLedgerDevices.keys()].map(path => ({ path })),
  default: {
    open: (path: string) => Promise.resolve(mockLedgerDevices.get(path)),
  },
}))

const SEED_ALL = mnemonicToSeed(MNEMONIC_ALL)
const SEED_OTHER = mnemonicToSeed(MNEMONIC_ALL, 'other passphrase')
// trezor-suite connect-core e2e fixtures solanaGetPublicKey for the "all" mnemonic
const ALL_BASE = new PublicKey('zZqNUDNijfbMXFy2wVCdJSm9MeMfxBMdxBqseSuiSW6')
const ALL_0_0 = new PublicKey('14CCvQzQzHCVgZM3j9soPnXuJXh1RmCfwLVUcdfbZVBS')

let deviceCounter = 0
function connectLedgers(...seeds: Buffer[]): FakeLedgerTransport[] {
  mockLedgerDevices.clear()
  return seeds.map(seed => {
    const transport = new FakeLedgerTransport(seed)
    mockLedgerDevices.set(`fake-ledger-${deviceCounter++}`, transport)
    return transport
  })
}

function transferTx(from: PublicKey): Transaction {
  const tx = new Transaction({
    feePayer: from,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  })
  return tx.add(
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  )
}

describe('LedgerWallet', () => {
  it('derives keys matching Trezor firmware fixtures', () => {
    expect(deriveKeypair(SEED_ALL, [44, 501]).publicKey).toEqual(ALL_BASE)
    expect(deriveKeypair(SEED_ALL, [44, 501, 0, 0]).publicKey).toEqual(ALL_0_0)
  })

  it('uses first device and default path for usb://ledger', async () => {
    connectLedgers(SEED_ALL)
    const wallet = await LedgerWallet.instance('usb://ledger')
    expect(wallet.publicKey).toEqual(ALL_BASE)
    expect(wallet.derivationPath).toEqual("44'/501'")
  })

  it('uses the key path for usb://ledger?key=0/0', async () => {
    connectLedgers(SEED_ALL)
    const wallet = await LedgerWallet.instance('usb://ledger?key=0/0')
    expect(wallet.publicKey).toEqual(ALL_0_0)
    expect(wallet.derivationPath).toEqual("44'/501'/0'/0'")
  })

  it('fails on multiple devices without wallet id', async () => {
    connectLedgers(SEED_OTHER, SEED_ALL)
    await expect(LedgerWallet.instance('usb://ledger?key=0/0')).rejects.toThrow(
      'Multiple ledger devices found, select one by wallet id: ' +
        `usb://ledger/${deriveKeypair(SEED_OTHER, [44, 501]).publicKey.toBase58()}, ` +
        `usb://ledger/${ALL_BASE.toBase58()}`,
    )
  })

  it('selects device by Agave wallet id and keeps the explicit key path', async () => {
    const [other, all] = connectLedgers(SEED_OTHER, SEED_ALL)
    const wallet = await LedgerWallet.instance(
      `usb://ledger/${ALL_BASE.toBase58()}?key=0/0`,
    )
    expect(wallet.publicKey).toEqual(ALL_0_0)
    expect(wallet.derivationPath).toEqual("44'/501'/0'/0'")

    const tx = transferTx(wallet.publicKey)
    await wallet.signTransaction(tx)
    expect(tx.verifySignatures()).toBe(true)
    expect(all!.signRequests).toHaveLength(1)
    expect(other!.signRequests).toHaveLength(0)
  })

  it('selects device by pubkey at the derivation path', async () => {
    connectLedgers(SEED_OTHER, SEED_ALL)
    const wallet = await LedgerWallet.instance(
      `usb://ledger/${ALL_0_0.toBase58()}?key=0/0`,
    )
    expect(wallet.publicKey).toEqual(ALL_0_0)
    expect(wallet.derivationPath).toEqual("44'/501'/0'/0'")
  })

  it('never replaces an explicit key path by account search', async () => {
    const [all] = connectLedgers(SEED_ALL)
    await expect(
      LedgerWallet.instance(`usb://ledger/${ALL_0_0.toBase58()}?key=1/0`),
    ).rejects.toThrow(
      `No ledger device provides pubkey ${ALL_0_0.toBase58()} as wallet id (44'/501') ` +
        "nor at derivation path 44'/501'/1'/0'",
    )
    expect(all!.signRequests).toHaveLength(0)
  })

  it('searches the derivation path when only the pubkey is provided', async () => {
    connectLedgers(SEED_OTHER, SEED_ALL)
    const target = deriveKeypair(SEED_ALL, [44, 501, 3, 1]).publicKey
    const wallet = await LedgerWallet.instance(
      `usb://ledger/${target.toBase58()}`,
    )
    expect(wallet.publicKey).toEqual(target)
    expect(wallet.derivationPath).toEqual("44'/501'/3'/1'")
  })

  it('signs legacy and versioned transactions in a batch', async () => {
    const [all] = connectLedgers(SEED_ALL)
    const wallet = await LedgerWallet.instance('usb://ledger?key=0/0')
    const legacy = transferTx(wallet.publicKey)
    const versioned = new VersionedTransaction(
      new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
        instructions: transferTx(wallet.publicKey).instructions,
      }).compileToV0Message(),
    )

    const [signedLegacy, signedVersioned] = await wallet.signAllTransactions<
      Transaction | VersionedTransaction
    >([legacy, versioned])

    expect((signedLegacy as Transaction).verifySignatures()).toBe(true)
    expect(all!.signRequests.map(r => r.message)).toEqual([
      legacy.serializeMessage(),
      Buffer.from(versioned.message.serialize()),
    ])
    expect(signedVersioned!.signatures[0]).toEqual(
      new Uint8Array(
        (await import('../test-utils/slip10')).signEd25519(
          deriveKeypair(SEED_ALL, [44, 501, 0, 0]),
          versioned.message.serialize(),
        ),
      ),
    )
  })

  it('signs chunked off-chain message verifiable as v0', async () => {
    const [all] = connectLedgers(SEED_ALL)
    const wallet = await LedgerWallet.instance('usb://ledger?key=0/0')
    const message = 'ě'.repeat(600)
    const domain = SystemProgram.programId.toBase58()

    const signature = await wallet.signOffchainMessage(message, domain)

    expect(all!.signRequests[0]!.ins).toEqual(0x07)
    expect(
      await verifyOffchainMessage(message, signature, wallet.publicKey, domain),
    ).toBe(true)
  })

  it('shows the address on device to confirm the key', async () => {
    const [all] = connectLedgers(SEED_ALL)
    const wallet = await LedgerWallet.instance('usb://ledger?key=0/0')
    expect(await wallet.confirmPublicKey()).toEqual(ALL_0_0)
    expect(all!.displayedPaths).toEqual([[44, 501, 0, 0]])
  })

  it.each([
    [0x5515, 'Ledger device is locked'],
    [0x6e01, 'Solana application is not opened'],
  ])('maps status 0x%s on connect', async (status, message) => {
    const [all] = connectLedgers(SEED_ALL)
    all!.behavior = { status }
    await expect(LedgerWallet.instance('usb://ledger')).rejects.toThrow(message)
  })

  it.each([
    [0x6985, 'Operation was rejected on the Ledger device'],
    [0x6808, 'does not permit blind signatures'],
    [0x6a81, 'rejected the message header as invalid'],
  ])('maps status 0x%s on signing', async (signStatus, message) => {
    const [all] = connectLedgers(SEED_ALL)
    const wallet = await LedgerWallet.instance('usb://ledger')
    all!.behavior = { signStatus }
    await expect(
      wallet.signTransaction(transferTx(wallet.publicKey)),
    ).rejects.toThrow(message)
  })
})
