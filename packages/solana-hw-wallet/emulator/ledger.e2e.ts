import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { verifyOffchainMessage } from '@marinade.finance/web3js-kit'
import { verifyOffchainMessageEnvelope } from '@solana/offchain-messages'
import { signOffchainMessageWithSigners } from '@solana/signers'
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
} from '@solana/web3.js'

import { SpeculosTransport, navigate } from './speculos'
import { LedgerWallet } from '../src/ledger'
import {
  MNEMONIC_ALL,
  deriveKeypair,
  mnemonicToSeed,
  signEd25519,
} from '../test-utils/slip10'

const ALL_0_0 = '14CCvQzQzHCVgZM3j9soPnXuJXh1RmCfwLVUcdfbZVBS'
const MESSAGE = 'Hello, Ledger!'
const KEY_0_0 = deriveKeypair(mnemonicToSeed(MNEMONIC_ALL), [44, 501, 0, 0])
const APPROVE =
  /^((Accept risk and (sign (transaction|message|operation))?)|(Sign (transaction|message|operation)))$/
const REJECT = /^(Reject( (transaction|message|operation))?)$/

function transfer(from: PublicKey): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: from,
    toPubkey: Keypair.generate().publicKey,
    lamports: 1,
  })
}

function legacyMessage(instruction: TransactionInstruction): Uint8Array {
  return new Transaction({
    feePayer: new PublicKey(ALL_0_0),
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  })
    .add(instruction)
    .serializeMessage()
}

void describe('LedgerWallet on Speculos with the Solana app', () => {
  let transport: SpeculosTransport
  let wallet: LedgerWallet

  before(async () => {
    transport = await SpeculosTransport.connect()
    // the wallet loads the HID transport lazily by require, the cached module points it to Speculos
    const id = require.resolve('@marinade.finance/ledger-hid-transport')
    require.cache[id] = {
      id,
      filename: id,
      loaded: true,
      exports: {
        __esModule: true,
        getDevices: () => Promise.resolve([{ path: 'speculos' }]),
        default: { open: () => Promise.resolve(transport) },
      },
    } as unknown as NodeJS.Module
    wallet = await LedgerWallet.instance('usb://ledger?key=0/0')
  })

  after(async () => {
    await transport.close()
  })

  void it('derives the address of the all x12 mnemonic', () => {
    assert.equal(wallet.address, ALL_0_0)
  })

  void it('refuses blind signing while it is off in the app settings', async () => {
    const unknownProgram = new TransactionInstruction({
      programId: Keypair.generate().publicKey,
      keys: [
        { pubkey: new PublicKey(ALL_0_0), isSigner: true, isWritable: true },
      ],
      data: Buffer.from([1, 2, 3]),
    })
    const [result] = await Promise.all([
      wallet
        .signTransactionMessage(legacyMessage(unknownProgram))
        .catch((e: unknown) => e),
      navigate(/Blind signing/),
    ])
    assert.match(String(result), /does not permit blind signatures/)
  })

  void it('signs a legacy transfer', async () => {
    const message = legacyMessage(transfer(new PublicKey(ALL_0_0)))
    const [signature] = await Promise.all([
      wallet.signTransactionMessage(message),
      navigate(APPROVE),
    ])
    assert.deepEqual(
      Buffer.from(signature),
      signEd25519(KEY_0_0, Buffer.from(message)),
    )
  })

  void it('signs a v0 transfer', async () => {
    const payer = new PublicKey(ALL_0_0)
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [transfer(payer)],
    })
      .compileToV0Message()
      .serialize()
    const [signature] = await Promise.all([
      wallet.signTransactionMessage(message),
      navigate(APPROVE),
    ])
    assert.deepEqual(
      Buffer.from(signature),
      signEd25519(KEY_0_0, Buffer.from(message)),
    )
  })

  void it('signs an off-chain message v0', async () => {
    const domain = SystemProgram.programId.toBase58()
    const [signature] = await Promise.all([
      wallet.signOffchainMessage(MESSAGE, domain),
      navigate(APPROVE),
    ])
    assert.ok(
      await verifyOffchainMessage(MESSAGE, signature, wallet.address, domain),
    )
  })

  void it('signs an off-chain message v1 through kit', async () => {
    const [envelope] = await Promise.all([
      signOffchainMessageWithSigners({
        version: 1,
        content: MESSAGE,
        requiredSignatories: [wallet],
      }),
      navigate(APPROVE),
    ])
    await verifyOffchainMessageEnvelope(envelope)
  })

  void it('reports a transfer rejected on the device', async () => {
    const [result] = await Promise.all([
      wallet
        .signTransactionMessage(legacyMessage(transfer(new PublicKey(ALL_0_0))))
        .catch((e: unknown) => e),
      navigate(REJECT),
    ])
    assert.match(String(result), /Operation was rejected on the Ledger device/)
  })
})
