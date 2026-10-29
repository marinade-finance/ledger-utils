import { randomBytes } from 'crypto'

import { getAddressDecoder } from '@solana/addresses'
import { blockhash } from '@solana/rpc-types'
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from 'web3js-v3'

import { LedgerWallet } from '../src/ledger'
import { signEd25519 } from '../test-utils/slip10'
import {
  KEY_0_0,
  LEDGER_0_0,
  connectLedger,
  describeWeb3Wallet,
} from '../test-utils/web3js-suite'

import type * as FakeLedgerModule from '../test-utils/fake-ledger'

jest.mock('@solana/web3.js', () => jest.requireActual<object>('web3js-v3'))
jest.mock(
  '@ledgerhq/hw-transport-node-hid-noevents',
  () =>
    jest.requireActual<typeof FakeLedgerModule>('../test-utils/fake-ledger')
      .fakeLedgerHidModule,
)

const randomBlockhash = () =>
  blockhash(getAddressDecoder().decode(randomBytes(32)))

const transfer = (from: PublicKey) =>
  SystemProgram.transfer({
    fromPubkey: from,
    toPubkey: new PublicKey(randomBytes(32)),
    lamports: 1,
  })

it('loads @solana/web3.js 3.x in place of 1.99', async () => {
  const web3 = await import('@solana/web3.js')
  expect(web3.PublicKey).toBe(PublicKey)
})

describeWeb3Wallet({
  label: 'web3.js 3.x',
  v1Error: 'Transaction version 1 is not supported by the Ledger Solana app',
})

describe('web3.js 3.x native kit signer', () => {
  it('partially signs a legacy transaction with the hardware wallet', async () => {
    const ledger = connectLedger()
    const wallet = await LedgerWallet.instance(LEDGER_0_0)
    const payer = new PublicKey(wallet.address)
    const tx = new Transaction({
      feePayer: payer,
      blockhash: randomBlockhash(),
      lastValidBlockHeight: 0,
    }).add(transfer(payer))

    await tx.partialSign(wallet)

    expect(ledger.signRequests.map(r => r.ins)).toEqual([0x06])
    expect(Buffer.from(tx.signatures[0]!.signature!)).toEqual(
      signEd25519(KEY_0_0, tx.serializeMessage()),
    )
  })

  it('signs a versioned transaction with the hardware wallet', async () => {
    const ledger = connectLedger()
    const wallet = await LedgerWallet.instance(LEDGER_0_0)
    const payer = new PublicKey(wallet.address)
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer,
        recentBlockhash: randomBlockhash(),
        instructions: [transfer(payer)],
      }).compileToV0Message(),
    )

    await tx.sign([wallet])

    expect(ledger.signRequests.map(r => r.ins)).toEqual([0x06])
    expect(Buffer.from(tx.signatures[0]!)).toEqual(
      signEd25519(KEY_0_0, tx.message.serialize()),
    )
  })
})
