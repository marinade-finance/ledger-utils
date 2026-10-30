import { verifyOffchainMessage } from '@marinade.finance/web3js-kit'
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'

import { LedgerWallet } from '../src/ledger'
import { toWeb3Wallet } from '../src/web3js'
import { FakeLedgerTransport } from '../test-utils/fake-ledger'
import {
  MNEMONIC_ALL,
  deriveKeypair,
  mnemonicToSeed,
} from '../test-utils/slip10'

const mockLedgerDevices = new Map<string, FakeLedgerTransport>()
const mockOpenedPaths: string[] = []
jest.mock('@ledgerhq/hw-transport-node-hid-noevents', () => ({
  __esModule: true,
  getDevices: () => [...mockLedgerDevices.keys()].map(path => ({ path })),
  default: {
    open: (path: string) => {
      mockOpenedPaths.push(path)
      return Promise.resolve(mockLedgerDevices.get(path))
    },
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
    expect(new PublicKey(deriveKeypair(SEED_ALL, [44, 501]).publicKey)).toEqual(
      ALL_BASE,
    )
    expect(
      new PublicKey(deriveKeypair(SEED_ALL, [44, 501, 0, 0]).publicKey),
    ).toEqual(ALL_0_0)
  })

  it('uses first device and default path for usb://ledger', async () => {
    connectLedgers(SEED_ALL)
    const wallet = await LedgerWallet.instance('usb://ledger')
    expect(wallet.address).toEqual(ALL_BASE.toBase58())
    expect(wallet.derivationPath).toEqual("44'/501'")
  })

  it('uses the key path for usb://ledger?key=0/0', async () => {
    connectLedgers(SEED_ALL)
    const wallet = await LedgerWallet.instance('usb://ledger?key=0/0')
    expect(wallet.address).toEqual(ALL_0_0.toBase58())
    expect(wallet.derivationPath).toEqual("44'/501'/0'/0'")
  })

  it('fails on multiple devices without wallet id', async () => {
    connectLedgers(SEED_OTHER, SEED_ALL)
    await expect(LedgerWallet.instance('usb://ledger?key=0/0')).rejects.toThrow(
      'Multiple ledger devices found, select one by wallet id: ' +
        `usb://ledger/${deriveKeypair(SEED_OTHER, [44, 501]).address}, ` +
        `usb://ledger/${ALL_BASE.toBase58()}`,
    )
  })

  it('lists readable wallet ids when another device cannot be read', async () => {
    const [other] = connectLedgers(SEED_OTHER, SEED_ALL)
    other!.behavior = { status: 0x6e01 }
    await expect(LedgerWallet.instance('usb://ledger')).rejects.toThrow(
      'Multiple ledger devices found, select one by wallet id: ' +
        `usb://ledger/${ALL_BASE.toBase58()} (1 more device cannot be read)`,
    )
  })

  it('opens each device once for concurrent wallets', async () => {
    connectLedgers(SEED_ALL)
    mockOpenedPaths.length = 0
    const [first, second] = await Promise.all([
      LedgerWallet.instance('usb://ledger?key=0/0'),
      LedgerWallet.instance('usb://ledger?key=0/1'),
    ])
    expect(first.address).toEqual(ALL_0_0.toBase58())
    expect(second.derivationPath).toEqual("44'/501'/0'/1'")
    expect(mockOpenedPaths).toHaveLength(1)
  })

  it('refuses a signature of another key than the wallet address', async () => {
    const [all] = connectLedgers(SEED_ALL)
    const wallet = await LedgerWallet.instance('usb://ledger?key=0/0')
    all!.behavior = { signSeed: SEED_OTHER }
    const error = `Ledger signed with another key than ${ALL_0_0.toBase58()}`
    await expect(
      wallet.signTransactionMessage(transferTx(ALL_0_0).serializeMessage()),
    ).rejects.toThrow(error)
    await expect(
      wallet.signOffchainMessage('hello', SystemProgram.programId.toBase58()),
    ).rejects.toThrow(error)
  })

  it('selects device by Agave wallet id and keeps the explicit key path', async () => {
    const [other, all] = connectLedgers(SEED_OTHER, SEED_ALL)
    const wallet = await LedgerWallet.instance(
      `usb://ledger/${ALL_BASE.toBase58()}?key=0/0`,
    )
    expect(wallet.address).toEqual(ALL_0_0.toBase58())
    expect(wallet.derivationPath).toEqual("44'/501'/0'/0'")

    const web3Wallet = await toWeb3Wallet(wallet)
    const tx = transferTx(web3Wallet.publicKey)
    await web3Wallet.signTransaction(tx)
    expect(tx.verifySignatures()).toBe(true)
    expect(all!.signRequests).toHaveLength(1)
    expect(other!.signRequests).toHaveLength(0)
  })

  it('selects device by pubkey at the derivation path', async () => {
    connectLedgers(SEED_OTHER, SEED_ALL)
    const wallet = await LedgerWallet.instance(
      `usb://ledger/${ALL_0_0.toBase58()}?key=0/0`,
    )
    expect(wallet.address).toEqual(ALL_0_0.toBase58())
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
    const target = new PublicKey(
      deriveKeypair(SEED_ALL, [44, 501, 3, 1]).publicKey,
    )
    const wallet = await LedgerWallet.instance(
      `usb://ledger/${target.toBase58()}`,
    )
    expect(wallet.address).toEqual(target.toBase58())
    expect(wallet.derivationPath).toEqual("44'/501'/3'/1'")
  })

  it('signs chunked off-chain message verifiable as v0', async () => {
    const [all] = connectLedgers(SEED_ALL)
    const wallet = await LedgerWallet.instance('usb://ledger?key=0/0')
    const message = 'ě'.repeat(600)
    const domain = SystemProgram.programId.toBase58()

    const signature = await wallet.signOffchainMessage(message, domain)

    expect(all!.signRequests[0]!.ins).toEqual(0x07)
    expect(
      await verifyOffchainMessage(message, signature, wallet.address, domain),
    ).toBe(true)
  })

  it('shows the address on device to confirm the key', async () => {
    const [all] = connectLedgers(SEED_ALL)
    const wallet = await LedgerWallet.instance('usb://ledger?key=0/0')
    expect(await wallet.confirmPublicKey()).toEqual(ALL_0_0.toBase58())
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
    const wallet = await toWeb3Wallet(
      await LedgerWallet.instance('usb://ledger'),
    )
    all!.behavior = { signStatus }
    await expect(
      wallet.signTransaction(transferTx(wallet.publicKey)),
    ).rejects.toThrow(message)
  })
})
