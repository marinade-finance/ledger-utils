import { hostname } from 'os'
import { createInterface } from 'readline/promises'

import { doWithLock, logInfo, logWarn } from '@marinade.finance/ts-common'
import { formatOffchainMessageV1 } from '@marinade.finance/web3js-kit'
import { address } from '@solana/addresses'
import { signatureBytes } from '@solana/keys'
import { getOffchainMessageDecoder } from '@solana/offchain-messages'

import { resolveDevice } from './discovery'
import {
  assertShownAddress,
  assertSignedBy,
  assertTransactionMessageVersion,
  signEach,
} from './signer'
import {
  WalletType,
  formatDerivationPath,
  parseWalletUrl,
  toHardenedPath,
} from './url'

import type { HardwareDevice } from './discovery'
import type {
  HardwareWallet,
  SignatureDictionary,
  SignerConfig,
} from './wallet'
import type { LoggerPlaceholder } from '@marinade.finance/ts-common'
import type { Address } from '@solana/addresses'
import type { SignatureBytes } from '@solana/keys'
import type TrezorConnectInstance from '@trezor/connect'
import type * as TrezorConnectModule from '@trezor/connect'
import type { Device } from '@trezor/connect'
import type * as TrezorTransportModule from '@trezor/transport'

type TrezorConnect = typeof TrezorConnectInstance
type ConnectTransports = NonNullable<
  Parameters<TrezorConnect['init']>[0]
>['transports']
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

export type TrezorSettings = {
  manifest?: TrezorManifest
  // also reach the device through Trezor Bridge or Suite on 127.0.0.1:21328, an unauthenticated local http port
  bridge?: boolean
}

// @trezor/connect keeps the event loop alive, closing it when idle lets the CLI exit on its own
const IDLE_CLOSE_MS = 1000
const TRANSPORT_START_TIMEOUT_MS = 10_000
// connect fails a second call to a device while one runs, kit signs partial signers concurrently
const TREZOR_LOCK = 'solana-hw-wallet:trezor'

const TREZOR_PACKAGES_MISSING =
  'Trezor support requires packages @trezor/connect and @trezor/transport to be installed'
const DEVICE_BUSY =
  'Trezor device is used by another application. Close Trezor Suite or other wallet and try again.'

// kept live by the device events, a session serves every wallet opened before the idle close
type Session = { devices: TrezorDevice[]; unacquired: Set<DevicePath> }

let session: Promise<Session> | null = null
// a new session waits for the dispose, which drops the listeners of every session
let closing: Promise<void> = Promise.resolve()
let pendingCalls = 0
let idleTimer: NodeJS.Timeout | undefined
const thpCredentials: ThpCredentials[] = []

class TrezorDevice implements HardwareDevice {
  constructor(
    public readonly connect: TrezorConnect,
    public readonly path: DevicePath,
  ) {}

  async getAddress(
    derivationPath: number[],
    showOnTrezor = false,
  ): Promise<Address> {
    const result = unwrap(
      await this.connect.solanaGetPublicKey({
        device: { path: this.path },
        path: toHardenedPath(derivationPath),
        showOnTrezor,
      }),
    )
    return address(result.publicKeyBase58)
  }
}

export class TrezorWallet implements HardwareWallet {
  // From url usb://trezor[/<pubkey>][?key=<derivation-path>] connects Trezor via '@trezor/connect'
  static async instance(
    trezorUrl = 'usb://trezor',
    logger: LoggerPlaceholder | undefined = undefined,
    settings: TrezorSettings = {},
  ): Promise<TrezorWallet> {
    const parsed = parseWalletUrl(trezorUrl)
    if (parsed.walletType !== WalletType.TREZOR) {
      throw new Error(`Not a Trezor wallet url: ${trezorUrl}`)
    }
    return withSession(settings, logger, async current => {
      const { device, derivationPath } = await resolveDevice({
        walletType: WalletType.TREZOR,
        devices: current.devices,
        walletId: parsed.walletId,
        derivationPath: parsed.derivationPath,
        explicitKey: parsed.explicitKey,
        logger,
        unopened: [...current.unacquired].map(() => new Error(DEVICE_BUSY)),
      })
      return new TrezorWallet(
        current,
        device,
        derivationPath,
        await device.getAddress(derivationPath),
        settings,
        logger,
      )
    })
  }

  // kit freezes fee payer signers, the reopened session lives in a nested object
  private readonly connection: { session: Session; device: TrezorDevice }

  private constructor(
    session: Session,
    device: TrezorDevice,
    private readonly derivationIndexes: number[],
    public readonly address: Address,
    private readonly settings: TrezorSettings,
    public readonly logger: LoggerPlaceholder | undefined = undefined,
  ) {
    this.connection = { session, device }
  }

  get derivationPath(): string {
    return formatDerivationPath(this.derivationIndexes)
  }

  public async signTransactionMessage(
    messageBytes: Uint8Array,
  ): Promise<SignatureBytes> {
    assertTransactionMessageVersion(messageBytes, 'Trezor')
    const { signature } = await this.withApproval(device =>
      device.connect.solanaSignTransaction({
        device: { path: device.path },
        path: toHardenedPath(this.derivationIndexes),
        serializedTx: Buffer.from(messageBytes).toString('hex'),
      }),
    )
    return assertSignedBy(
      this.address,
      messageBytes,
      signatureBytes(Buffer.from(signature, 'hex')),
      'Trezor',
    )
  }

  // kit TransactionPartialSigner
  public async signTransactions(
    transactions: readonly { messageBytes: ArrayLike<number> }[],
    config?: SignerConfig,
  ): Promise<readonly SignatureDictionary[]> {
    const messages = transactions.map(t => t.messageBytes)
    messages.forEach(m => assertTransactionMessageVersion(m, 'Trezor'))
    return signEach(this.address, messages, config, bytes =>
      this.signTransactionMessage(bytes),
    )
  }

  // kit MessagePartialSigner, the firmware builds off-chain message v1 itself from text and signers
  public async signMessages(
    messages: readonly { content: ArrayLike<number> }[],
    config?: SignerConfig,
  ): Promise<readonly SignatureDictionary[]> {
    return signEach(
      this.address,
      messages.map(m => m.content),
      config,
      async bytes => {
        const decoded = getOffchainMessageDecoder().decode(bytes)
        if (decoded.version !== 1) {
          throw new Error('Trezor signs off-chain messages of version 1 only')
        }
        const signers = decoded.requiredSignatories.map(s => s.address)
        // the text decoder drops NUL and BOM, the firmware would sign other bytes
        if (
          !Buffer.from(
            formatOffchainMessageV1(decoded.content, signers),
          ).equals(bytes)
        ) {
          throw new Error(
            'Trezor cannot sign this off-chain message, its text does not encode back to the same bytes',
          )
        }
        return this.signOffchainMessage(decoded.content, signers)
      },
    )
  }

  // off-chain message format v1 (firmware >= 2.12.4), verify with verifyOffchainMessageV1
  public async signOffchainMessage(
    message: string,
    signers?: Address[],
  ): Promise<SignatureBytes> {
    const { signature } = await this.withApproval(device =>
      device.connect.solanaSignMessage({
        device: { path: device.path },
        path: toHardenedPath(this.derivationIndexes),
        message,
        signers,
      }),
    )
    return assertSignedBy(
      this.address,
      formatOffchainMessageV1(message, signers ?? [this.address]),
      signatureBytes(Buffer.from(signature, 'hex')),
      'Trezor',
    )
  }

  // Solana CLI --confirm-key: user verifies the address shown on the device
  public async confirmPublicKey(): Promise<Address> {
    logInfo(
      this.logger,
      `Confirm the address on Trezor hardware wallet ${this.derivationPath}`,
    )
    const shown = await this.withDevice(device =>
      device.getAddress(this.derivationIndexes, true),
    )
    return assertShownAddress(this.address, shown, 'Trezor')
  }

  private async withApproval<R>(
    action: (device: TrezorDevice) => Promise<TrezorResponse<R>>,
  ): Promise<R> {
    return this.withDevice(async device => {
      logInfo(
        this.logger,
        `Waiting for your approval on Trezor hardware wallet ${
          this.derivationPath
        } [[${this.address}]]`,
      )
      const result = unwrap(await action(device))
      logInfo(this.logger, '✅ Approved')
      return result
    })
  }

  private async withDevice<R>(
    action: (device: TrezorDevice) => Promise<R>,
  ): Promise<R> {
    return withSession(this.settings, this.logger, async current => {
      if (current !== this.connection.session) {
        const { device } = await resolveDevice({
          walletType: WalletType.TREZOR,
          devices: current.devices,
          walletId: this.address,
          derivationPath: this.derivationIndexes,
          explicitKey: true,
          logger: this.logger,
        })
        this.connection.session = current
        this.connection.device = device
      }
      return action(this.connection.device)
    })
  }
}

// closes @trezor/connect right away, next wallet call opens it again
export async function closeTrezorConnect(): Promise<void> {
  clearTimeout(idleTimer)
  const current = session
  session = null
  if (current !== null) {
    closing = disposeSession(current)
  }
  await closing
}

async function disposeSession(current: Promise<Session>): Promise<void> {
  try {
    await current
    ;(await loadTrezorConnect()).default.dispose()
  } catch {
    /* failed session is already disposed */
  }
}

async function withSession<R>(
  settings: TrezorSettings,
  logger: LoggerPlaceholder | undefined,
  action: (current: Session) => Promise<R>,
): Promise<R> {
  clearTimeout(idleTimer)
  pendingCalls++
  try {
    if (session === null) {
      const opening = closing.then(() => openSession(settings, logger))
      session = opening
      opening.catch(() => {
        if (session === opening) {
          session = null
        }
      })
    }
    const opened = session
    return await doWithLock(TREZOR_LOCK, async () => action(await opened))
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
    if (response.error.code === 'Device_FwException') {
      throw new Error(
        'Trezor firmware is too old for this action, update it in Trezor Suite (Device_FwException)',
      )
    }
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
    throw new Error(TREZOR_PACKAGES_MISSING, { cause: e })
  }
}

async function loadTrezorTransport(): Promise<typeof TrezorTransportModule> {
  try {
    return await import('@trezor/transport')
  } catch (e) {
    throw new Error(TREZOR_PACKAGES_MISSING, { cause: e })
  }
}

async function openSession(
  { manifest = DEFAULT_TREZOR_MANIFEST, bridge = false }: TrezorSettings,
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

  // connect tries the bridge first by default, a local process listening there would act as the device
  let transports: ConnectTransports
  if (!bridge) {
    const { NodeUsbTransport } = await loadTrezorTransport()
    // connect types a vendored copy of the transport class, at runtime it checks the methods only
    transports = [
      new NodeUsbTransport({ id: manifest.appName }),
    ] as unknown as ConnectTransports
  }

  // events are delivered after init resolves, initial devices connect before the transport start
  let transportTimeout: NodeJS.Timeout | undefined
  let transportError = `no transport started within ${
    TRANSPORT_START_TIMEOUT_MS / 1000
  }s` as string | undefined
  const transportStarted = new Promise<void>(resolve => {
    connect.on(TRANSPORT.START, () => {
      transportError = undefined
      resolve()
    })
    connect.on(TRANSPORT.ERROR, event => {
      transportError = event.error
      resolve()
    })
    transportTimeout = setTimeout(resolve, TRANSPORT_START_TIMEOUT_MS)
  })
  const opened: Session = { devices: [], unacquired: new Set() }
  connect.on(DEVICE.CONNECT, device => {
    // a device released by another application connects again under its unacquired path
    opened.unacquired.delete(device.path)
    opened.devices.push(new TrezorDevice(connect, device.path))
  })
  connect.on(DEVICE.CONNECT_UNACQUIRED, device => {
    opened.unacquired.add(device.path)
  })
  connect.on(DEVICE.DISCONNECT, device => {
    opened.unacquired.delete(device.path)
    opened.devices = opened.devices.filter(d => d.path !== device.path)
  })
  connect.on(DEVICE.THP_CREDENTIALS_CHANGED, event => {
    thpCredentials.push(event.credentials)
  })
  // signing asks for a confirmation only on a seed without backup, anything else is refused
  connect.on(UI_REQUESTS.REQUEST_CONFIRMATION, event => {
    const noBackup = event.view === 'no-backup'
    if (noBackup) {
      logWarn(logger, 'Trezor seed has no backup, create one in Trezor Suite')
    }
    connect.uiResponse({
      type: UI_RESPONSE.RECEIVE_CONFIRMATION,
      payload: noBackup,
      requestId: event.requestId,
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
      transports,
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

  if (opened.devices.length === 0 && opened.unacquired.size > 0) {
    connect.dispose()
    throw new Error(DEVICE_BUSY)
  }
  if (opened.devices.length === 0 && transportError !== undefined) {
    connect.dispose()
    throw new Error(
      `Trezor transport failed to start: ${transportError}. On Linux check the Trezor udev rules.`,
    )
  }
  return opened
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
