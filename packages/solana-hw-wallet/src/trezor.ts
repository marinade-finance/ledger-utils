import { hostname } from 'os'
import { createInterface } from 'readline/promises'

import { logInfo } from '@marinade.finance/ts-common'
import { PublicKey } from '@solana/web3.js'

import { resolveDevice } from './discovery'
import {
  WalletType,
  formatDerivationPath,
  parseWalletUrl,
  toHardenedPath,
} from './url'
import { serializeTransactionMessage } from './wallet'

import type { HardwareDevice } from './discovery'
import type { Wallet } from './wallet'
import type { LoggerPlaceholder } from '@marinade.finance/ts-common'
import type { Transaction, VersionedTransaction } from '@solana/web3.js'
import type TrezorConnectInstance from '@trezor/connect'
import type * as TrezorConnectModule from '@trezor/connect'
import type { Device } from '@trezor/connect'

type TrezorConnect = typeof TrezorConnectInstance
type DevicePath = Device['path']
type ThpCredentials = NonNullable<Device['thp']>['credentials'][number]
type TrezorResponse<T> =
  | { success: true; payload: T }
  | { success: false; error: { message: string; code?: string } }

export type TrezorManifest = {
  appName: string
  appUrl: string
  email: string
}

export const DEFAULT_TREZOR_MANIFEST: TrezorManifest = {
  appName: '@marinade.finance/solana-hw-wallet',
  appUrl: 'https://marinade.finance',
  email: 'info@marinade.finance',
}

// @trezor/connect keeps the event loop alive, closing it when idle lets the CLI exit on its own
const IDLE_CLOSE_MS = 1000
const TRANSPORT_START_TIMEOUT_MS = 10_000

type Session = { devices: TrezorDevice[] }

let session: Promise<Session> | null = null
let pendingCalls = 0
let idleTimer: NodeJS.Timeout | undefined
const thpCredentials: ThpCredentials[] = []

class TrezorDevice implements HardwareDevice {
  constructor(
    public readonly connect: TrezorConnect,
    public readonly path: DevicePath,
  ) {}

  async getPublicKey(
    derivationPath: number[],
    showOnTrezor = false,
  ): Promise<PublicKey> {
    const result = unwrap(
      await this.connect.solanaGetPublicKey({
        device: { path: this.path },
        path: toHardenedPath(derivationPath),
        showOnTrezor,
      }),
    )
    return new PublicKey(result.publicKeyBase58)
  }
}

export class TrezorWallet implements Wallet {
  // From url usb://trezor[/<pubkey>][?key=<derivation-path>] connects Trezor via '@trezor/connect'
  static async instance(
    trezorUrl = 'usb://trezor',
    logger: LoggerPlaceholder | undefined = undefined,
    manifest: TrezorManifest = DEFAULT_TREZOR_MANIFEST,
  ): Promise<TrezorWallet> {
    const parsed = parseWalletUrl(trezorUrl)
    if (parsed.walletType !== WalletType.TREZOR) {
      throw new Error(`Not a Trezor wallet url: ${trezorUrl}`)
    }
    return withSession(manifest, logger, async current => {
      const { device, derivationPath } = await resolveDevice({
        walletType: WalletType.TREZOR,
        devices: current.devices,
        walletId: parsed.walletId,
        derivationPath: parsed.derivationPath,
        explicitKey: parsed.explicitKey,
        logger,
      })
      const publicKey = await device.getPublicKey(derivationPath)
      return new TrezorWallet(
        current,
        device,
        derivationPath,
        publicKey,
        manifest,
        logger,
      )
    })
  }

  private constructor(
    private session: Session,
    private device: TrezorDevice,
    private readonly derivationIndexes: number[],
    public readonly publicKey: PublicKey,
    private readonly manifest: TrezorManifest,
    public readonly logger: LoggerPlaceholder | undefined = undefined,
  ) {}

  get derivationPath(): string {
    return 'm/' + formatDerivationPath(this.derivationIndexes)
  }

  public async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    const { signature } = await this.withApproval(device =>
      device.connect.solanaSignTransaction({
        device: { path: device.path },
        path: toHardenedPath(this.derivationIndexes),
        serializedTx: serializeTransactionMessage(tx).toString('hex'),
      }),
    )
    tx.addSignature(this.publicKey, Buffer.from(signature, 'hex'))
    return tx
  }

  public async signAllTransactions<
    T extends Transaction | VersionedTransaction,
  >(txs: T[]): Promise<T[]> {
    const signedTxs: T[] = []
    for (const tx of txs) {
      signedTxs.push(await this.signTransaction(tx))
    }
    return signedTxs
  }

  // off-chain message format v1 (firmware >= 2.12.4), verify with verifyOffchainMessageV1
  public async signOffchainMessage(
    message: string,
    signers?: PublicKey[],
  ): Promise<Buffer> {
    const { signature } = await this.withApproval(device =>
      device.connect.solanaSignMessage({
        device: { path: device.path },
        path: toHardenedPath(this.derivationIndexes),
        message,
        signers: signers?.map(s => s.toBase58()),
      }),
    )
    return Buffer.from(signature, 'hex')
  }

  // Solana CLI --confirm-key: user verifies the address shown on the device
  public async confirmPublicKey(): Promise<PublicKey> {
    logInfo(
      this.logger,
      `Confirm the address on Trezor hardware wallet ${this.derivationPath}`,
    )
    return this.withDevice(device =>
      device.getPublicKey(this.derivationIndexes, true),
    )
  }

  private async withApproval<R>(
    action: (device: TrezorDevice) => Promise<TrezorResponse<R>>,
  ): Promise<R> {
    return this.withDevice(async device => {
      logInfo(
        this.logger,
        `Waiting for your approval on Trezor hardware wallet ${
          this.derivationPath
        } [[${this.publicKey.toBase58()}]]`,
      )
      const result = unwrap(await action(device))
      logInfo(this.logger, '✅ Approved')
      return result
    })
  }

  private async withDevice<R>(
    action: (device: TrezorDevice) => Promise<R>,
  ): Promise<R> {
    return withSession(this.manifest, this.logger, async current => {
      if (current !== this.session) {
        const { device } = await resolveDevice({
          walletType: WalletType.TREZOR,
          devices: current.devices,
          walletId: this.publicKey,
          derivationPath: this.derivationIndexes,
          explicitKey: true,
          logger: this.logger,
        })
        this.session = current
        this.device = device
      }
      return action(this.device)
    })
  }
}

// closes @trezor/connect right away, next wallet call opens it again
export async function closeTrezorConnect(): Promise<void> {
  clearTimeout(idleTimer)
  const current = session
  session = null
  if (current !== null) {
    try {
      await current
      ;(await loadTrezorConnect()).default.dispose()
    } catch {
      /* failed session is already disposed */
    }
  }
}

async function withSession<R>(
  manifest: TrezorManifest,
  logger: LoggerPlaceholder | undefined,
  action: (current: Session) => Promise<R>,
): Promise<R> {
  clearTimeout(idleTimer)
  pendingCalls++
  try {
    if (session === null) {
      const opening = openSession(manifest, logger)
      session = opening
      opening.catch(() => {
        if (session === opening) {
          session = null
        }
      })
    }
    return await action(await session)
  } finally {
    pendingCalls--
    if (pendingCalls === 0) {
      idleTimer = setTimeout(() => {
        void closeTrezorConnect()
      }, IDLE_CLOSE_MS)
      idleTimer.unref()
    }
  }
}

function unwrap<T>(response: TrezorResponse<T>): T {
  if (!response.success) {
    throw new Error(
      `Trezor: ${response.error.message}` +
        (response.error.code ? ` (${response.error.code})` : ''),
    )
  }
  return response.payload
}

async function loadTrezorConnect(): Promise<typeof TrezorConnectModule> {
  try {
    return await import('@trezor/connect')
  } catch (e) {
    throw new Error(
      'Trezor support requires package @trezor/connect to be installed',
      { cause: e },
    )
  }
}

async function openSession(
  manifest: TrezorManifest,
  logger: LoggerPlaceholder | undefined,
): Promise<Session> {
  const {
    default: connect,
    DEVICE,
    TRANSPORT,
    UI_EVENTS,
    UI_REQUESTS,
    UI_RESPONSE,
  } = await loadTrezorConnect()

  // events are delivered after init resolves, initial devices connect before the transport start
  let transportTimeout: NodeJS.Timeout | undefined
  const transportStarted = new Promise<void>(resolve => {
    connect.on(TRANSPORT.START, () => resolve())
    connect.on(TRANSPORT.ERROR, () => resolve())
    transportTimeout = setTimeout(resolve, TRANSPORT_START_TIMEOUT_MS)
  })
  const paths: DevicePath[] = []
  let unacquired = 0
  connect.on(DEVICE.CONNECT, device => {
    paths.push(device.path)
  })
  connect.on(DEVICE.CONNECT_UNACQUIRED, () => {
    unacquired++
  })
  connect.on(DEVICE.THP_CREDENTIALS_CHANGED, event => {
    thpCredentials.push(event.credentials)
  })
  connect.on(UI_REQUESTS.REQUEST_CONFIRMATION, () => {
    connect.uiResponse({
      type: UI_RESPONSE.RECEIVE_CONFIRMATION,
      payload: true,
    })
  })
  connect.on(UI_REQUESTS.REQUEST_PASSPHRASE, event => {
    connect.uiResponse({
      type: UI_RESPONSE.RECEIVE_PASSPHRASE,
      payload: { value: '', passphraseOnDevice: true },
      requestId: event.requestId,
    })
  })
  connect.on(UI_REQUESTS.REQUEST_THP_PAIRING_TAG, event => {
    void readPairingCode().then(tag =>
      tag === undefined
        ? connect.cancel('Trezor pairing code not provided')
        : connect.uiResponse({
            type: UI_RESPONSE.RECEIVE_THP_PAIRING_TAG,
            payload: { tag },
            requestId: event.requestId,
          }),
    )
  })
  connect.on(UI_EVENTS.BUTTON_REQUEST, () => {
    logInfo(logger, 'Confirm the action on your Trezor device')
  })

  try {
    // pendingTransportEvent: init waits for the connected devices to be handshaked
    await connect.init({
      manifest,
      pendingTransportEvent: true,
      thp: {
        appName: manifest.appName,
        hostName: hostname(),
        knownCredentials: thpCredentials,
        pairingMethods: ['CodeEntry'],
      },
    })
    await transportStarted
  } catch (e) {
    connect.dispose()
    throw e
  } finally {
    clearTimeout(transportTimeout)
  }

  if (paths.length === 0 && unacquired > 0) {
    connect.dispose()
    throw new Error(
      'Trezor device is used by another application. Close Trezor Suite or other wallet and try again.',
    )
  }
  return { devices: paths.map(path => new TrezorDevice(connect, path)) }
}

async function readPairingCode(): Promise<string | undefined> {
  if (!process.stdin.isTTY) {
    return undefined
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const code = (await rl.question('Enter Trezor pairing code: ')).trim()
    return code === '' ? undefined : code
  } finally {
    rl.close()
  }
}
