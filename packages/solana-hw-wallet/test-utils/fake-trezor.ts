import { PublicKey } from '@solana/web3.js'

import { deriveKeypair, signEd25519 } from './slip10'

type Listener = (payload: { path: string; requestId?: number }) => void
type Call = { method: string; params: Record<string, unknown> }

const DEVICE = {
  CONNECT: 'device-connect',
  CONNECT_UNACQUIRED: 'device-connect_unacquired',
  THP_CREDENTIALS_CHANGED: 'device-thp_credentials_changed',
}
const TRANSPORT = { START: 'transport-start', ERROR: 'transport-error' }
const UI_EVENTS = { BUTTON_REQUEST: 'ui-event_button_request' }
const UI_REQUESTS = {
  REQUEST_CONFIRMATION: 'ui-request_confirmation',
  REQUEST_PASSPHRASE: 'ui-request_passphrase',
  REQUEST_THP_PAIRING_TAG: 'ui-request_thp_pairing_tag',
}
const UI_RESPONSE = {
  RECEIVE_CONFIRMATION: 'ui-receive_confirmation',
  RECEIVE_PASSPHRASE: 'ui-receive_passphrase',
  RECEIVE_THP_PAIRING_TAG: 'ui-receive_thp_pairing_tag',
}

// in-process stand-in for the default export of @trezor/connect, keys derived from device seeds
export class FakeTrezorConnect {
  public seeds: Buffer[] = []
  public unacquired = 0
  public initCount = 0
  public disposeCount = 0
  private devices: { path: string; seed: Buffer }[] = []
  public failure: { message: string; code: string } | undefined
  public readonly calls: Call[] = []
  public initSettings: Record<string, unknown> | undefined
  private readonly listeners = new Map<string, Listener[]>()

  on(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  uiResponse(): void {}

  cancel(): void {}

  // as connect, dispose drops all listeners
  dispose(): void {
    this.disposeCount++
    this.devices = []
    this.listeners.clear()
  }

  // like connect, device paths are a counter of the device list created by each init
  async init(settings: Record<string, unknown>): Promise<void> {
    this.initSettings = settings
    this.initCount++
    this.devices = this.seeds.map((seed, i) => ({
      path: `trezor-${this.initCount}-${i}`,
      seed,
    }))
    // as connect, events are delivered after init resolves
    setTimeout(() => {
      for (const { path } of this.devices) {
        this.emit(DEVICE.CONNECT, { path })
      }
      for (let i = 0; i < this.unacquired; i++) {
        this.emit(DEVICE.CONNECT_UNACQUIRED, { path: `busy-${i}` })
      }
      this.emit(TRANSPORT.START, { path: '' })
    }, 0)
  }

  async solanaGetPublicKey(params: {
    device: { path: string }
    path: number[]
  }) {
    return this.respond('solanaGetPublicKey', params, seed => ({
      publicKeyBase58: deriveKeypair(
        seed,
        unharden(params.path),
      ).publicKey.toBase58(),
    }))
  }

  async solanaSignTransaction(params: {
    device: { path: string }
    path: number[]
    serializedTx: string
  }) {
    return this.respond('solanaSignTransaction', params, seed => ({
      signature: signEd25519(
        deriveKeypair(seed, unharden(params.path)),
        Buffer.from(params.serializedTx, 'hex'),
      ).toString('hex'),
    }))
  }

  async solanaSignMessage(params: {
    device: { path: string }
    path: number[]
    message: string
    signers?: string[]
  }) {
    return this.respond('solanaSignMessage', params, seed => {
      const keypair = deriveKeypair(seed, unharden(params.path))
      const signers = (params.signers ?? [keypair.publicKey.toBase58()]).map(
        s => new PublicKey(s).toBuffer(),
      )
      // OCMS v1 envelope: 0xff "solana offchain" version=1 signers-count signers message
      const signedData = Buffer.concat([
        Buffer.from([0xff]),
        Buffer.from('solana offchain'),
        Buffer.from([1, signers.length]),
        ...signers,
        Buffer.from(params.message, 'utf-8'),
      ])
      return {
        signature: signEd25519(keypair, signedData).toString('hex'),
        signedData: signedData.toString('hex'),
      }
    })
  }

  private respond<T>(
    method: string,
    params: { device: { path: string } },
    action: (seed: Buffer) => T,
  ) {
    this.calls.push({ method, params })
    const device = this.devices.find(d => d.path === params.device.path)
    if (this.failure !== undefined || device === undefined) {
      return {
        success: false as const,
        error: this.failure ?? {
          message: 'Device not found',
          code: 'Device_NotFound',
        },
      }
    }
    return { success: true as const, payload: action(device.seed) }
  }

  private emit(event: string, payload: { path: string }): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload)
    }
  }
}

function unharden(path: number[]): number[] {
  return path.map(i => i & 0x7fffffff)
}

export const fakeTrezor = new FakeTrezorConnect()

export const fakeTrezorModule = {
  __esModule: true,
  default: fakeTrezor,
  DEVICE,
  TRANSPORT,
  UI_EVENTS,
  UI_REQUESTS,
  UI_RESPONSE,
}
