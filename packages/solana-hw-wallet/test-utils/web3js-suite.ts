import { randomBytes } from 'crypto'

import { verifyOffchainMessage } from '@marinade.finance/web3js-kit'
import {
  MessageV1,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'

import { FakeLedgerTransport, fakeLedgerDevices } from './fake-ledger'
import {
  MNEMONIC_ALL,
  deriveKeypair,
  mnemonicToSeed,
  signEd25519,
} from './slip10'
import { parseHardwareWallet } from '../src/cli'
import { LedgerWallet } from '../src/ledger'
import { serializeTransactionMessage } from '../src/wallet'

const SEED_ALL = mnemonicToSeed(MNEMONIC_ALL)
export const KEY_0_0 = deriveKeypair(SEED_ALL, [44, 501, 0, 0])
export const LEDGER_0_0 = 'usb://ledger?key=0/0'

let deviceCounter = 0
export function connectLedger(): FakeLedgerTransport {
  fakeLedgerDevices.clear()
  const transport = new FakeLedgerTransport(SEED_ALL)
  fakeLedgerDevices.set(`fake-ledger-web3-${deviceCounter++}`, transport)
  return transport
}

export function randomKey(): PublicKey {
  return new PublicKey(randomBytes(32))
}

// the blockhash constructor exists in @solana/web3.js 1.99 and 3.x
export function transferTx(from: PublicKey): Transaction {
  return new Transaction({
    feePayer: from,
    blockhash: randomKey().toBase58(),
    lastValidBlockHeight: 0,
  }).add(
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: randomKey(),
      lamports: 1,
    }),
  )
}

/**
 * Cases of the Anchor compatible Wallet run against whichever @solana/web3.js the spec loads.
 *
 * @param label the web3.js version under test
 * @param v1Error the error of signing a version 1 transaction with that web3.js
 */
export function describeWeb3Wallet({
  label,
  v1Error,
}: {
  label: string
  v1Error: string
}) {
  describe(`web3.js Wallet with ${label}`, () => {
    it('parses url into web3.js wallet with the device address', async () => {
      connectLedger()
      const wallet = await parseHardwareWallet(` ${LEDGER_0_0} `)
      expect(wallet?.publicKey).toBeInstanceOf(PublicKey)
      expect(wallet?.publicKey.toBase58()).toEqual(KEY_0_0.address)
    })

    it('signs legacy and versioned transactions in a batch', async () => {
      const ledger = connectLedger()
      const wallet = (await parseHardwareWallet(LEDGER_0_0))!
      const legacy = transferTx(wallet.publicKey)
      const versioned = new VersionedTransaction(
        new TransactionMessage({
          payerKey: wallet.publicKey,
          recentBlockhash: randomKey().toBase58(),
          instructions: transferTx(wallet.publicKey).instructions,
        }).compileToV0Message(),
      )

      const [signedLegacy, signedVersioned] = await wallet.signAllTransactions<
        Transaction | VersionedTransaction
      >([legacy, versioned])

      const messages = [legacy, versioned].map(tx =>
        Buffer.from(serializeTransactionMessage(tx)),
      )
      expect(ledger.signRequests.map(r => Buffer.from(r.message))).toEqual(
        messages,
      )
      expect(
        Buffer.from((signedLegacy as Transaction).signatures[0]!.signature!),
      ).toEqual(signEd25519(KEY_0_0, messages[0]!))
      expect(
        Buffer.from((signedVersioned as VersionedTransaction).signatures[0]!),
      ).toEqual(signEd25519(KEY_0_0, messages[1]!))
    })

    it('fails on v1 transaction before reaching the device', async () => {
      const ledger = connectLedger()
      const wallet = (await parseHardwareWallet(LEDGER_0_0))!
      const tx = new VersionedTransaction(
        new MessageV1({
          header: {
            numRequiredSignatures: 1,
            numReadonlySignedAccounts: 0,
            numReadonlyUnsignedAccounts: 1,
          },
          staticAccountKeys: [wallet.publicKey, SystemProgram.programId],
          recentBlockhash: randomKey().toBase58(),
          compiledInstructions: [
            {
              programIdIndex: 1,
              accountKeyIndexes: [0],
              data: new Uint8Array(),
            },
          ],
        }),
      )

      await expect(wallet.signTransaction(tx)).rejects.toThrow(v1Error)
      expect(ledger.signRequests).toHaveLength(0)
    })

    it('signs an off-chain message with the hardware wallet of the parsed web3.js wallet', async () => {
      const ledger = connectLedger()
      const wallet = (await parseHardwareWallet(LEDGER_0_0))!
      const hardwareWallet = wallet.hardwareWallet
      expect(hardwareWallet).toBeInstanceOf(LedgerWallet)
      expect(hardwareWallet.address).toEqual(KEY_0_0.address)
      const domain = SystemProgram.programId.toBase58()

      const signature = await (
        hardwareWallet as LedgerWallet
      ).signOffchainMessage('web3', domain)

      expect(ledger.signRequests.map(r => r.ins)).toEqual([0x07])
      expect(
        await verifyOffchainMessage('web3', signature, KEY_0_0.address, domain),
      ).toBe(true)
    })
  })
}
