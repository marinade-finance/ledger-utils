import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'

import {
  MNEMONIC_ALL,
  deriveKeypair,
  mnemonicToSeed,
} from '../test-utils/slip10'

import type * as OffchainModule from '../src/offchain'
import type * as TrezorModule from '../src/trezor'
import type * as FakeTrezorModule from '../test-utils/fake-trezor'
import type { FakeTrezorConnect } from '../test-utils/fake-trezor'

jest.mock(
  '@trezor/connect',
  () =>
    jest.requireActual<typeof FakeTrezorModule>('../test-utils/fake-trezor')
      .fakeTrezorModule,
)

const SEED_ALL = mnemonicToSeed(MNEMONIC_ALL)
const SEED_OTHER = mnemonicToSeed(MNEMONIC_ALL, 'other passphrase')
// trezor-suite connect-core e2e fixtures solanaGetPublicKey for the "all" mnemonic
const ALL_BASE = new PublicKey('zZqNUDNijfbMXFy2wVCdJSm9MeMfxBMdxBqseSuiSW6')
const ALL_0_0 = new PublicKey('14CCvQzQzHCVgZM3j9soPnXuJXh1RmCfwLVUcdfbZVBS')
const HARDENED_0_0 = [0x8000002c, 0x800001f5, 0x80000000, 0x80000000]

let TrezorWallet: typeof TrezorModule.TrezorWallet
let closeTrezorConnect: typeof TrezorModule.closeTrezorConnect
let verifyOffchainMessageV1: typeof OffchainModule.verifyOffchainMessageV1
let fakeTrezor: FakeTrezorConnect

// module state of @trezor/connect init is per process, reset to connect a new set of devices
beforeEach(async () => {
  jest.resetModules()
  ;({ TrezorWallet, closeTrezorConnect } = await import('../src/trezor'))
  ;({ verifyOffchainMessageV1 } = await import('../src/offchain'))
  ;({ fakeTrezor } = await import('../test-utils/fake-trezor'))
})

afterEach(async () => {
  await closeTrezorConnect()
})

function connectTrezors(...seeds: Buffer[]): void {
  fakeTrezor.seeds = seeds
}

function transferTx(from: PublicKey): Transaction {
  return new Transaction({
    feePayer: from,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  )
}

describe('TrezorWallet', () => {
  it('initializes connect for node with manifest and pending transport', async () => {
    connectTrezors(SEED_ALL)
    const wallet = await TrezorWallet.instance('usb://trezor?key=0/0')
    expect(wallet.publicKey).toEqual(ALL_0_0)
    expect(wallet.derivationPath).toEqual("m/44'/501'/0'/0'")
    expect(fakeTrezor.initSettings).toMatchObject({
      manifest: { appName: '@marinade.finance/solana-hw-wallet' },
      pendingTransportEvent: true,
    })
    expect(fakeTrezor.calls.at(-1)).toEqual({
      method: 'solanaGetPublicKey',
      params: {
        device: { path: 'trezor-1-0' },
        path: HARDENED_0_0,
        showOnTrezor: false,
      },
    })
  })

  it('selects device by Agave wallet id', async () => {
    connectTrezors(SEED_OTHER, SEED_ALL)
    const wallet = await TrezorWallet.instance(
      `usb://trezor/${ALL_BASE.toBase58()}?key=0/0`,
    )
    expect(wallet.publicKey).toEqual(ALL_0_0)

    const tx = transferTx(wallet.publicKey)
    await wallet.signTransaction(tx)
    expect(tx.verifySignatures()).toBe(true)
    expect(fakeTrezor.calls.at(-1)).toEqual({
      method: 'solanaSignTransaction',
      params: {
        device: { path: 'trezor-1-1' },
        path: HARDENED_0_0,
        serializedTx: tx.serializeMessage().toString('hex'),
      },
    })
  })

  it('fails on multiple devices without wallet id', async () => {
    connectTrezors(SEED_OTHER, SEED_ALL)
    await expect(TrezorWallet.instance('usb://trezor')).rejects.toThrow(
      'Multiple trezor devices found, select one by wallet id',
    )
  })

  it('searches the derivation path when only the pubkey is provided', async () => {
    connectTrezors(SEED_ALL)
    const target = deriveKeypair(SEED_ALL, [44, 501, 2]).publicKey
    const wallet = await TrezorWallet.instance(
      `usb://trezor/${target.toBase58()}`,
    )
    expect(wallet.derivationPath).toEqual("m/44'/501'/2'")
  })

  it('signs versioned transaction message', async () => {
    connectTrezors(SEED_ALL)
    const wallet = await TrezorWallet.instance('usb://trezor?key=0/0')
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
        instructions: transferTx(wallet.publicKey).instructions,
      }).compileToV0Message(),
    )
    const [signed] = await wallet.signAllTransactions([tx])
    expect(fakeTrezor.calls.at(-1)?.params.serializedTx).toEqual(
      Buffer.from(tx.message.serialize()).toString('hex'),
    )
    expect(signed!.signatures[0]).not.toEqual(new Uint8Array(64))
  })

  it('signs off-chain message verifiable as v1', async () => {
    connectTrezors(SEED_ALL)
    const wallet = await TrezorWallet.instance('usb://trezor?key=0/0')
    const coSigner = Keypair.generate().publicKey

    const signature = await wallet.signOffchainMessage('Hello, Trezor!')
    const coSigned = await wallet.signOffchainMessage('co-signed', [
      wallet.publicKey,
      coSigner,
    ])

    expect(signature.toString('hex')).toEqual(
      'f2580d7f82bf2f9737925e7817d5b04cfe8b5e9b1f3c138517a9c55f2bb1f95524db937ec2a1dfebf67a1dc3ab27ef80629854ee2af5cb0ceb40568bc1bdb503',
    )
    expect(
      await verifyOffchainMessageV1('co-signed', coSigned, wallet.publicKey, [
        wallet.publicKey,
        coSigner,
      ]),
    ).toBe(true)
  })

  it('shows the address on device to confirm the key', async () => {
    connectTrezors(SEED_ALL)
    const wallet = await TrezorWallet.instance('usb://trezor?key=0/0')
    expect(await wallet.confirmPublicKey()).toEqual(ALL_0_0)
    expect(fakeTrezor.calls.at(-1)?.params.showOnTrezor).toBe(true)
  })

  it('reports failure from connect', async () => {
    connectTrezors(SEED_ALL)
    const wallet = await TrezorWallet.instance('usb://trezor')
    fakeTrezor.failure = {
      message: 'Cancelled',
      code: 'Failure_ActionCancelled',
    }
    await expect(
      wallet.signTransaction(transferTx(wallet.publicKey)),
    ).rejects.toThrow('Trezor: Cancelled (Failure_ActionCancelled)')
  })

  it('reports device used by another application', async () => {
    fakeTrezor.unacquired = 1
    await expect(TrezorWallet.instance('usb://trezor')).rejects.toThrow(
      'Trezor device is used by another application',
    )
  })

  it('reports no device found', async () => {
    await expect(TrezorWallet.instance('usb://trezor')).rejects.toThrow(
      'No trezor device found',
    )
  })

  it('closes connect when idle so the process can exit', async () => {
    connectTrezors(SEED_ALL)
    await TrezorWallet.instance('usb://trezor')
    expect(fakeTrezor.disposeCount).toBe(0)
    await new Promise(resolve => {
      setTimeout(resolve, 1100)
    })
    expect(fakeTrezor.disposeCount).toBe(1)
  })

  it('reopens connect and re-identifies the device after close', async () => {
    connectTrezors(SEED_OTHER, SEED_ALL)
    const wallet = await TrezorWallet.instance(
      `usb://trezor/${ALL_BASE.toBase58()}?key=0/0`,
    )
    await closeTrezorConnect()
    connectTrezors(SEED_ALL, SEED_OTHER)

    const tx = transferTx(wallet.publicKey)
    await wallet.signTransaction(tx)

    expect(fakeTrezor.initCount).toBe(2)
    expect(tx.verifySignatures()).toBe(true)
    expect(fakeTrezor.calls.at(-1)?.params.device).toEqual({
      path: 'trezor-2-0',
    })
  })

  it('refuses to sign when the device was swapped after close', async () => {
    connectTrezors(SEED_ALL)
    const wallet = await TrezorWallet.instance('usb://trezor?key=0/0')
    await closeTrezorConnect()
    connectTrezors(SEED_OTHER)

    await expect(
      wallet.signTransaction(transferTx(wallet.publicKey)),
    ).rejects.toThrow(`No trezor device provides pubkey ${ALL_0_0.toBase58()}`)
    expect(
      fakeTrezor.calls.filter(c => c.method === 'solanaSignTransaction'),
    ).toHaveLength(0)
  })

  it('disposes connect when no device is usable', async () => {
    fakeTrezor.unacquired = 1
    await expect(TrezorWallet.instance('usb://trezor')).rejects.toThrow(
      'used by another application',
    )
    expect(fakeTrezor.disposeCount).toBe(1)
  })
})
