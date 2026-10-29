import { randomBytes } from 'crypto'

import {
  address,
  getAddressDecoder,
  getAddressFromPublicKey,
  getPublicKeyFromAddress,
} from '@solana/addresses'
import { generateKeyPair, signatureBytes, verifySignature } from '@solana/keys'
import { blockhash } from '@solana/rpc-types'
import {
  appendTransactionMessageInstruction,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/transaction-messages'
import { compileTransaction } from '@solana/transactions'

import { FakeLedgerTransport } from '../test-utils/fake-ledger'
import { MNEMONIC_ALL, mnemonicToSeed } from '../test-utils/slip10'

jest.mock('@solana/web3.js', () => {
  throw new Error("Cannot find module '@solana/web3.js'")
})
const mockLedgerDevices = new Map<string, FakeLedgerTransport>()
jest.mock('@ledgerhq/hw-transport-node-hid-noevents', () => ({
  __esModule: true,
  getDevices: () => [...mockLedgerDevices.keys()].map(path => ({ path })),
  default: {
    open: (path: string) => Promise.resolve(mockLedgerDevices.get(path)),
  },
}))

const ALL_0_0 = address('14CCvQzQzHCVgZM3j9soPnXuJXh1RmCfwLVUcdfbZVBS')
const APP_DOMAIN = '11111111111111111111111111111111'

describe('without @solana/web3.js installed', () => {
  let transport: FakeLedgerTransport
  let deviceCounter = 0
  beforeEach(() => {
    transport = new FakeLedgerTransport(mnemonicToSeed(MNEMONIC_ALL))
    mockLedgerDevices.clear()
    mockLedgerDevices.set(`fake-ledger-no-web3-${deviceCounter++}`, transport)
  })

  it('cannot load @solana/web3.js', async () => {
    await expect(import('@solana/web3.js')).rejects.toThrow(
      "Cannot find module '@solana/web3.js'",
    )
  })

  it('signs kit transaction with the hardware wallet', async () => {
    const { openHardwareWallet } = await import('../src')
    const wallet = await openHardwareWallet('usb://ledger?key=0/0')
    const tx = compileTransaction(
      appendTransactionMessageInstruction(
        { programAddress: address('11111111111111111111111111111111') },
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: blockhash(getAddressDecoder().decode(randomBytes(32))),
            lastValidBlockHeight: 0n,
          },
          setTransactionMessageFeePayer(
            wallet.address,
            createTransactionMessage({ version: 0 }),
          ),
        ),
      ),
    )

    const [signatures] = await wallet.signTransactions([tx])

    expect(
      await verifySignature(
        await getPublicKeyFromAddress(ALL_0_0),
        signatureBytes(Uint8Array.from(signatures![ALL_0_0] ?? [])),
        Uint8Array.from(tx.messageBytes),
      ),
    ).toBe(true)
  })

  it('signs and verifies off-chain message with a kit key pair', async () => {
    const { signOffchainMessage, verifyOffchainMessage } =
      await import('../src')
    const keyPair = await generateKeyPair()

    const signature = await signOffchainMessage('kit', keyPair, APP_DOMAIN)

    expect(
      await verifyOffchainMessage(
        'kit',
        signature,
        await getAddressFromPublicKey(keyPair.publicKey),
        APP_DOMAIN,
      ),
    ).toBe(true)
  })

  it('explains the missing package for the web3.js wallet before reaching the device', async () => {
    const { parseHardwareWallet } = await import('../src')
    const exchange = jest.spyOn(transport, 'exchange')

    await expect(parseHardwareWallet('usb://ledger')).rejects.toThrow(
      'Anchor compatible Wallet requires package @solana/web3.js to be installed',
    )
    expect(exchange).not.toHaveBeenCalled()
  })
})
