import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import TrezorConnect, { UI_EVENTS } from '@trezor/connect'

import { verifyOffchainMessageV1 } from '../src/offchain'
import { TrezorWallet, closeTrezorConnect } from '../src/trezor'
import {
  MNEMONIC_ALL,
  deriveKeypair,
  mnemonicToSeed,
  signEd25519,
} from '../test-utils/slip10'

// trezor-user-env (ghcr.io/trezor/trezor-user-env) controller, see .github/workflows
const USER_ENV_URL = process.env.TREZOR_USER_ENV_URL ?? 'ws://127.0.0.1:9001/'
const BRIDGE_URL = 'http://127.0.0.1:21328'
const EMULATOR_MODEL = process.env.TREZOR_EMULATOR_MODEL ?? 'T3T1'
const ALL_BASE = new PublicKey('zZqNUDNijfbMXFy2wVCdJSm9MeMfxBMdxBqseSuiSW6')
const ALL_0_0 = new PublicKey('14CCvQzQzHCVgZM3j9soPnXuJXh1RmCfwLVUcdfbZVBS')
const SEED_ALL = mnemonicToSeed(MNEMONIC_ALL)

class UserEnv {
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (r: unknown) => void; reject: (e: Error) => void }
  >()

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', event => {
      const data = JSON.parse(String(event.data)) as {
        id?: string
        success?: boolean
        error?: unknown
        response?: unknown
      }
      const request = this.pending.get(Number(data.id))
      if (request === undefined) {
        return
      }
      this.pending.delete(Number(data.id))
      if (data.success === false) {
        request.reject(
          new Error(`trezor-user-env: ${JSON.stringify(data.error)}`),
        )
      } else {
        request.resolve(data.response)
      }
    })
  }

  static async connect(): Promise<UserEnv> {
    const ws = new WebSocket(USER_ENV_URL)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('message', () => resolve(), { once: true })
      ws.addEventListener(
        'error',
        () => reject(new Error(`Cannot connect ${USER_ENV_URL}`)),
        { once: true },
      )
    })
    return new UserEnv(ws)
  }

  async send(
    type: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    const id = this.nextId++
    const response = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
    this.ws.send(JSON.stringify({ id: id.toString(), type, ...params }))
    return response
  }

  close(): void {
    this.ws.close()
  }
}

// a real device is plugged in before the CLI starts, the emulator appears in bridge a moment after start
async function waitForBridgeDevice(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${BRIDGE_URL}/enumerate`, {
        method: 'POST',
      })
      if (((await response.json()) as unknown[]).length > 0) {
        return
      }
    } catch {
      /* bridge not listening yet */
    }
    await new Promise(resolve => {
      setTimeout(resolve, 1000)
    })
  }
  throw new Error(`No emulator device found at bridge ${BRIDGE_URL}`)
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

void describe('TrezorWallet on firmware emulator', () => {
  let userEnv: UserEnv

  before(async () => {
    userEnv = await UserEnv.connect()
    await userEnv.send('bridge-stop')
    await userEnv.send('emulator-stop')
    await userEnv.send('emulator-start', {
      model: EMULATOR_MODEL,
      version: '2-latest',
      wipe: true,
    })
    await userEnv.send('emulator-setup', {
      mnemonic: MNEMONIC_ALL,
      pin: '',
      passphrase_protection: false,
      label: 'solana-hw-wallet',
      needs_backup: false,
    })
    await userEnv.send('bridge-start', { version: 'node-bridge' })
    await waitForBridgeDevice()
  })

  after(async () => {
    await closeTrezorConnect()
    await userEnv.send('emulator-stop')
    userEnv.close()
  })

  // connect dispose drops listeners, register on every session opened by the wallet
  async function withAutoConfirm<R>(action: () => Promise<R>): Promise<R> {
    const pressYes = () => {
      setTimeout(() => {
        void userEnv.send('emulator-press-yes')
      }, 200)
    }
    TrezorConnect.on(UI_EVENTS.BUTTON_REQUEST, pressYes)
    try {
      return await action()
    } finally {
      TrezorConnect.off(UI_EVENTS.BUTTON_REQUEST, pressYes)
    }
  }

  void it('signs legacy and versioned transactions with the derived key', async () => {
    await withAutoConfirm(async () => {
      const wallet = await TrezorWallet.instance('usb://trezor?key=0/0')
      assert.deepEqual(wallet.publicKey, ALL_0_0)

      const legacy = transferTx(wallet.publicKey)
      const versioned = new VersionedTransaction(
        new TransactionMessage({
          payerKey: wallet.publicKey,
          recentBlockhash: Keypair.generate().publicKey.toBase58(),
          instructions: transferTx(wallet.publicKey).instructions,
        }).compileToV0Message(),
      )
      await wallet.signAllTransactions<Transaction | VersionedTransaction>([
        legacy,
        versioned,
      ])

      const key = deriveKeypair(SEED_ALL, [44, 501, 0, 0])
      assert.ok(legacy.verifySignatures())
      assert.deepEqual(
        Buffer.from(versioned.signatures[0] ?? []),
        signEd25519(key, versioned.message.serialize()),
      )
    })
  })

  void it('selects the device by Agave wallet id', async () => {
    await withAutoConfirm(async () => {
      const wallet = await TrezorWallet.instance(
        `usb://trezor/${ALL_BASE.toBase58()}?key=0/0`,
      )
      assert.deepEqual(wallet.publicKey, ALL_0_0)
    })
  })

  void it('signs off-chain message v1', async () => {
    await withAutoConfirm(async () => {
      const wallet = await TrezorWallet.instance('usb://trezor?key=0/0')
      const signature = await wallet.signOffchainMessage('Hello, Trezor!')
      assert.equal(
        signature.toString('hex'),
        'f2580d7f82bf2f9737925e7817d5b04cfe8b5e9b1f3c138517a9c55f2bb1f95524db937ec2a1dfebf67a1dc3ab27ef80629854ee2af5cb0ceb40568bc1bdb503',
      )
      assert.ok(
        await verifyOffchainMessageV1('Hello, Trezor!', signature, ALL_0_0),
      )
    })
  })
})
