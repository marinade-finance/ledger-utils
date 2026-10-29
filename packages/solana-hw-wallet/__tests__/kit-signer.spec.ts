import { randomBytes } from 'crypto'

import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getPublicKeyFromAddress,
} from '@solana/addresses'
import { signatureBytes, verifySignature } from '@solana/keys'
import {
  compileOffchainMessageEnvelope,
  offchainMessageApplicationDomain,
  offchainMessageContentRestrictedAsciiOf1232BytesMax,
  verifyOffchainMessageEnvelope,
} from '@solana/offchain-messages'
import { blockhash } from '@solana/rpc-types'
import {
  setTransactionMessageFeePayerSigner,
  signOffchainMessageWithSigners,
  signTransactionMessageWithSigners,
} from '@solana/signers'
import {
  appendTransactionMessageInstruction,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/transaction-messages'
import { compileTransaction } from '@solana/transactions'

import { FakeLedgerTransport } from '../test-utils/fake-ledger'
import { MNEMONIC_ALL, mnemonicToSeed } from '../test-utils/slip10'

import type * as LedgerModule from '../src/ledger'
import type * as TrezorModule from '../src/trezor'
import type { HardwareWallet } from '../src/wallet'
import type * as FakeTrezorModule from '../test-utils/fake-trezor'
import type { FakeTrezorConnect } from '../test-utils/fake-trezor'
import type { Address } from '@solana/addresses'
import type {
  MessagePartialSigner,
  TransactionPartialSigner,
} from '@solana/signers'

const mockLedgerDevices = new Map<string, FakeLedgerTransport>()
jest.mock('@ledgerhq/hw-transport-node-hid-noevents', () => ({
  __esModule: true,
  getDevices: () => [...mockLedgerDevices.keys()].map(path => ({ path })),
  default: {
    open: (path: string) => Promise.resolve(mockLedgerDevices.get(path)),
  },
}))
jest.mock(
  '@trezor/connect',
  () =>
    jest.requireActual<typeof FakeTrezorModule>('../test-utils/fake-trezor')
      .fakeTrezorModule,
)

const SEED_ALL = mnemonicToSeed(MNEMONIC_ALL)
const ALL_0_0 = address('14CCvQzQzHCVgZM3j9soPnXuJXh1RmCfwLVUcdfbZVBS')
const CO_SIGNER = address('7v91N7iZ9mNicL8WfG6cgSCKyRXydQjLh6UYBWwm6y1Q')
const SYSTEM_PROGRAM = address('11111111111111111111111111111111')
const APP_DOMAIN = '11111111111111111111111111111111'

let LedgerWallet: typeof LedgerModule.LedgerWallet
let TrezorWallet: typeof TrezorModule.TrezorWallet
let closeTrezorConnect: typeof TrezorModule.closeTrezorConnect
let fakeTrezor: FakeTrezorConnect

beforeEach(async () => {
  jest.resetModules()
  ;({ LedgerWallet } = await import('../src/ledger'))
  ;({ TrezorWallet, closeTrezorConnect } = await import('../src/trezor'))
  ;({ fakeTrezor } = await import('../test-utils/fake-trezor'))
})

afterEach(async () => {
  await closeTrezorConnect()
})

let deviceCounter = 0
function connectLedger(): FakeLedgerTransport {
  mockLedgerDevices.clear()
  const transport = new FakeLedgerTransport(SEED_ALL)
  mockLedgerDevices.set(`fake-ledger-kit-${deviceCounter++}`, transport)
  return transport
}

type OpenedWallet = { wallet: HardwareWallet; signingCalls: () => number }
const openWallet: Record<'ledger' | 'trezor', () => Promise<OpenedWallet>> = {
  ledger: async () => {
    const transport = connectLedger()
    return {
      wallet: await LedgerWallet.instance('usb://ledger?key=0/0'),
      signingCalls: () => transport.signRequests.length,
    }
  },
  trezor: async () => {
    fakeTrezor.seeds = [SEED_ALL]
    return {
      wallet: await TrezorWallet.instance('usb://trezor?key=0/0'),
      signingCalls: () =>
        fakeTrezor.calls.filter(c => c.method !== 'solanaGetPublicKey').length,
    }
  },
}

function randomLifetime() {
  return {
    blockhash: blockhash(getAddressDecoder().decode(randomBytes(32))),
    lastValidBlockHeight: 0n,
  }
}

function transactionMessage(feePayer: Address, version: 'legacy' | 0 | 1) {
  return appendTransactionMessageInstruction(
    { programAddress: SYSTEM_PROGRAM },
    setTransactionMessageLifetimeUsingBlockhash(
      randomLifetime(),
      setTransactionMessageFeePayer(
        feePayer,
        createTransactionMessage({ version }),
      ),
    ),
  )
}

function signerTransactionMessage(signer: TransactionPartialSigner) {
  return appendTransactionMessageInstruction(
    { programAddress: SYSTEM_PROGRAM },
    setTransactionMessageLifetimeUsingBlockhash(
      randomLifetime(),
      setTransactionMessageFeePayerSigner(
        signer,
        createTransactionMessage({ version: 0 }),
      ),
    ),
  )
}

async function verifyBy(
  signer: Address,
  signature: ArrayLike<number> | null | undefined,
  data: ArrayLike<number>,
): Promise<boolean> {
  return verifySignature(
    await getPublicKeyFromAddress(signer),
    signatureBytes(Uint8Array.from(signature ?? [])),
    Uint8Array.from(data),
  )
}

describe.each(['ledger', 'trezor'] as const)('%s as kit signer', name => {
  it.each(['legacy', 0] as const)(
    'signs %s transaction message bytes',
    async version => {
      const { wallet } = await openWallet[name]()
      const tx = compileTransaction(transactionMessage(wallet.address, version))

      const [signatures] = await wallet.signTransactions([tx])

      expect(Object.keys(signatures!)).toEqual([ALL_0_0])
      expect(
        await verifyBy(ALL_0_0, signatures![ALL_0_0], tx.messageBytes),
      ).toBe(true)
    },
  )

  it('signs through kit signTransactionMessageWithSigners', async () => {
    const { wallet } = await openWallet[name]()
    const signer: TransactionPartialSigner & MessagePartialSigner = wallet

    const tx = await signTransactionMessageWithSigners(
      signerTransactionMessage(signer),
    )

    expect(
      await verifyBy(ALL_0_0, tx.signatures[ALL_0_0], tx.messageBytes),
    ).toBe(true)
  })

  it('signs off-chain message v1 through kit signOffchainMessageWithSigners', async () => {
    const { wallet } = await openWallet[name]()

    const envelope = await signOffchainMessageWithSigners({
      version: 1,
      content: 'Hello, Trezor!',
      requiredSignatories: [wallet],
    })

    await expect(verifyOffchainMessageEnvelope(envelope)).resolves.toBe(
      undefined,
    )
    expect(Buffer.from(envelope.signatures[ALL_0_0]!).toString('hex')).toEqual(
      'f2580d7f82bf2f9737925e7817d5b04cfe8b5e9b1f3c138517a9c55f2bb1f95524db937ec2a1dfebf67a1dc3ab27ef80629854ee2af5cb0ceb40568bc1bdb503',
    )
  })

  it('does not reach the device when aborted', async () => {
    const { wallet, signingCalls } = await openWallet[name]()
    const controller = new AbortController()
    controller.abort(new Error('user aborted'))

    await expect(
      wallet.signTransactions(
        [compileTransaction(transactionMessage(wallet.address, 0))],
        { abortSignal: controller.signal },
      ),
    ).rejects.toThrow('user aborted')
    await expect(
      wallet.signMessages(
        [
          compileOffchainMessageEnvelope({
            version: 1,
            content: 'aborted',
            requiredSignatories: [{ address: wallet.address }],
          }),
        ],
        { abortSignal: controller.signal },
      ),
    ).rejects.toThrow('user aborted')
    expect(signingCalls()).toBe(0)
  })
})

describe('two keys of one device', () => {
  const open: Record<
    'ledger' | 'trezor',
    (key: string) => Promise<HardwareWallet>
  > = {
    ledger: key => LedgerWallet.instance(`usb://ledger?key=${key}`),
    trezor: key => TrezorWallet.instance(`usb://trezor?key=${key}`),
  }

  it.each(['ledger', 'trezor'] as const)(
    'sign one %s transaction through kit signTransactionMessageWithSigners',
    async name => {
      connectLedger()
      fakeTrezor.seeds = [SEED_ALL]
      const feePayer = await open[name]('0/0')
      const authority = await open[name]('0/1')
      const message = appendTransactionMessageInstruction(
        {
          programAddress: SYSTEM_PROGRAM,
          accounts: [
            { address: authority.address, role: 2, signer: authority },
          ],
        },
        signerTransactionMessage(feePayer),
      )

      const tx = await signTransactionMessageWithSigners(message)

      for (const signer of [feePayer.address, authority.address]) {
        expect(
          await verifyBy(signer, tx.signatures[signer], tx.messageBytes),
        ).toBe(true)
      }
    },
  )
})

describe('Ledger kit message signer', () => {
  it('passes off-chain message v0 bytes to the device unchanged', async () => {
    const transport = connectLedger()
    const wallet = await LedgerWallet.instance('usb://ledger?key=0/0')

    // Omit<> over the v0 | v1 union drops applicationDomain from the literal type check
    const v0Message = {
      version: 0 as const,
      applicationDomain: offchainMessageApplicationDomain(APP_DOMAIN),
      content: offchainMessageContentRestrictedAsciiOf1232BytesMax('Hello'),
      requiredSignatories: [wallet],
    }
    const envelope = await signOffchainMessageWithSigners(v0Message)

    await expect(verifyOffchainMessageEnvelope(envelope)).resolves.toBe(
      undefined,
    )
    expect(transport.signRequests.map(r => [r.ins, r.message])).toEqual([
      [0x07, Buffer.from(envelope.content)],
    ])
  })
})

describe.each([
  ['ledger', 'the Ledger Solana app'],
  ['trezor', 'Trezor'],
] as const)('transaction message version 1 on %s', (name, device) => {
  const v1Error = `Transaction version 1 is not supported by ${device}, sign a legacy or v0 transaction instead`

  it('is refused before reaching the device', async () => {
    const { wallet, signingCalls } = await openWallet[name]()
    const v1 = compileTransaction(transactionMessage(wallet.address, 1))
    expect(v1.messageBytes[0]).toEqual(0x81)

    await expect(wallet.signTransactions([v1])).rejects.toThrow(v1Error)
    await expect(
      wallet.signTransactionMessage(Uint8Array.from(v1.messageBytes)),
    ).rejects.toThrow(v1Error)
    expect(signingCalls()).toBe(0)
  })

  it('is refused before signing any transaction of the batch', async () => {
    const { wallet, signingCalls } = await openWallet[name]()

    await expect(
      wallet.signTransactions([
        compileTransaction(transactionMessage(wallet.address, 0)),
        compileTransaction(transactionMessage(wallet.address, 1)),
      ]),
    ).rejects.toThrow(v1Error)
    expect(signingCalls()).toBe(0)
  })
})

describe('Trezor kit message signer', () => {
  it('rejects off-chain message v0 before reaching the device', async () => {
    fakeTrezor.seeds = [SEED_ALL]
    const wallet = await TrezorWallet.instance('usb://trezor?key=0/0')
    const envelope = compileOffchainMessageEnvelope({
      version: 0,
      applicationDomain: offchainMessageApplicationDomain(APP_DOMAIN),
      content: offchainMessageContentRestrictedAsciiOf1232BytesMax('Hello'),
      requiredSignatories: [{ address: wallet.address }],
    })

    await expect(wallet.signMessages([envelope])).rejects.toThrow(
      'Trezor signs off-chain messages of version 1 only',
    )
    expect(
      fakeTrezor.calls.filter(c => c.method === 'solanaSignMessage'),
    ).toHaveLength(0)
  })

  it('rejects off-chain message v1 the firmware cannot rebuild from text', async () => {
    fakeTrezor.seeds = [SEED_ALL]
    const wallet = await TrezorWallet.instance('usb://trezor?key=0/0')
    const withNul = Buffer.concat([
      Buffer.from([0xff]),
      Buffer.from('solana offchain'),
      Buffer.from([1, 1]),
      Buffer.from(getAddressEncoder().encode(ALL_0_0)),
      Buffer.from('a\u0000b'),
    ])

    await expect(wallet.signMessages([{ content: withNul }])).rejects.toThrow(
      'Trezor cannot sign this off-chain message',
    )
    expect(
      fakeTrezor.calls.filter(c => c.method === 'solanaSignMessage'),
    ).toHaveLength(0)
  })

  it('rejects off-chain message v1 with unsorted signers before reaching the device', async () => {
    fakeTrezor.seeds = [SEED_ALL]
    const wallet = await TrezorWallet.instance('usb://trezor?key=0/0')
    const encoder = getAddressEncoder()
    const unsorted = Buffer.concat([
      Buffer.from([0xff]),
      Buffer.from('solana offchain'),
      Buffer.from([1, 2]),
      Buffer.from(encoder.encode(CO_SIGNER)),
      Buffer.from(encoder.encode(ALL_0_0)),
      Buffer.from('unsorted'),
    ])

    await expect(wallet.signMessages([{ content: unsorted }])).rejects.toThrow(
      'The signatories of this offchain message must be listed in lexicographical order',
    )
    expect(
      fakeTrezor.calls.filter(c => c.method === 'solanaSignMessage'),
    ).toHaveLength(0)
  })
})
