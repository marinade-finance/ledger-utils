import { logInfo, scheduleOnExit } from '@marinade.finance/ts-common'
import { getAddressDecoder } from '@solana/addresses'
import { signatureBytes } from '@solana/keys'

import { resolveDevice } from './discovery'
import { formatOffchainMessage } from './offchain'
import { signEach } from './signer'
import { WalletType, formatDerivationPath, parseWalletUrl } from './url'

import type { HardwareDevice } from './discovery'
import type { SignatureDictionary, SignerConfig } from './wallet'
import type Solana from '@ledgerhq/hw-app-solana'
import type Transport from '@ledgerhq/hw-transport'
import type TransportNodeHid from '@ledgerhq/hw-transport-node-hid-noevents'
import type { getDevices } from '@ledgerhq/hw-transport-node-hid-noevents'
import type { LoggerPlaceholder } from '@marinade.finance/ts-common'
import type { Address } from '@solana/addresses'
import type { SignatureBytes } from '@solana/keys'

const IN_LIB_TRANSPORT_CACHE: Map<string, Transport> = new Map()

const LOCKED = 'Ledger device is locked. Please, unlock it first.'
const APP_NOT_OPENED =
  'Solana application is not opened. Please, open the Solana app on the Ledger device first.'
const LEDGER_STATUS_MESSAGES: Record<number, string> = {
  0x5515: LOCKED,
  0x6982: LOCKED,
  0x6985: 'Operation was rejected on the Ledger device.',
  0x6511: APP_NOT_OPENED,
  0x6700: APP_NOT_OPENED,
  0x6d00: APP_NOT_OPENED,
  0x6d02: APP_NOT_OPENED,
  0x6e00: APP_NOT_OPENED,
  0x6e01: APP_NOT_OPENED,
  0x6a80:
    'Ledger Solana app rejected the message as invalid. Consider updating the Solana app.',
  0x6a81: 'Ledger Solana app rejected the message header as invalid.',
  0x6a82: 'Ledger Solana app rejected the message format as invalid.',
  0x6a83: 'Ledger Solana app rejected the message size as invalid.',
}

class LedgerDevice implements HardwareDevice {
  constructor(public readonly api: Solana) {}

  async getAddress(
    derivationPath: number[],
    display = false,
  ): Promise<Address> {
    const { address } = await this.api.getAddress(
      formatDerivationPath(derivationPath),
      display,
    )
    return getAddressDecoder().decode(address)
  }
}

export class LedgerWallet {
  // From url usb://ledger[/<pubkey>][?key=<derivation-path>] opens Ledger via '@ledgerhq/hw-app-solana'
  static async instance(
    ledgerUrl = 'usb://ledger',
    logger: LoggerPlaceholder | undefined = undefined,
  ): Promise<LedgerWallet> {
    const parsed = parseWalletUrl(ledgerUrl)
    if (parsed.walletType !== WalletType.LEDGER) {
      throw new Error(`Not a Ledger wallet url: ${ledgerUrl}`)
    }
    try {
      const devices = await openLedgerDevices()
      const { device, derivationPath } = await resolveDevice({
        walletType: WalletType.LEDGER,
        devices,
        walletId: parsed.walletId,
        derivationPath: parsed.derivationPath,
        explicitKey: parsed.explicitKey,
        logger,
      })
      return new LedgerWallet(
        device,
        formatDerivationPath(derivationPath),
        await device.getAddress(derivationPath),
        logger,
      )
    } catch (e) {
      throw toLedgerError(e)
    }
  }

  private constructor(
    private readonly device: LedgerDevice,
    public readonly derivationPath: string,
    public readonly address: Address,
    public readonly logger: LoggerPlaceholder | undefined = undefined,
  ) {}

  public async signTransactionMessage(
    messageBytes: Uint8Array,
  ): Promise<SignatureBytes> {
    assertLedgerTransactionVersion(messageBytes)
    return this.withApproval(async () => {
      const { signature } = await this.device.api.signTransaction(
        this.derivationPath,
        Buffer.from(messageBytes),
      )
      return signatureBytes(signature)
    })
  }

  // kit TransactionPartialSigner
  public async signTransactions(
    transactions: readonly { messageBytes: ArrayLike<number> }[],
    config?: SignerConfig,
  ): Promise<readonly SignatureDictionary[]> {
    const messages = transactions.map(t => t.messageBytes)
    messages.forEach(assertLedgerTransactionVersion)
    return signEach(this.address, messages, config, bytes =>
      this.signTransactionMessage(bytes),
    )
  }

  // kit MessagePartialSigner, content is an encoded off-chain message the Solana app accepts (v0, v1)
  public async signMessages(
    messages: readonly { content: ArrayLike<number> }[],
    config?: SignerConfig,
  ): Promise<readonly SignatureDictionary[]> {
    return signEach(
      this.address,
      messages.map(m => m.content),
      config,
      bytes => this.signOffchainBytes(bytes),
    )
  }

  // off-chain message format v0, applicationDomain is base58 of 32 bytes, verify with verifyOffchainMessage
  public async signOffchainMessage(
    message: string,
    applicationDomain: string,
  ): Promise<Buffer> {
    return Buffer.from(
      await this.signOffchainBytes(
        formatOffchainMessage(message, applicationDomain, this.address),
      ),
    )
  }

  private async signOffchainBytes(bytes: Uint8Array): Promise<SignatureBytes> {
    return this.withApproval(async () => {
      const { signature } = await this.device.api.signOffchainMessage(
        this.derivationPath,
        Buffer.from(bytes),
      )
      return signatureBytes(signature)
    })
  }

  // Solana CLI --confirm-key: user verifies the address shown on the device
  public async confirmPublicKey(): Promise<Address> {
    return this.withApproval(async () => {
      const { address } = await this.device.api.getAddress(
        this.derivationPath,
        true,
      )
      return getAddressDecoder().decode(address)
    })
  }

  private async withApproval<R>(action: () => Promise<R>): Promise<R> {
    logInfo(
      this.logger,
      `Waiting for your approval on Ledger hardware wallet ${
        this.derivationPath
      } [[${this.address}]]`,
    )
    try {
      const result = await action()
      logInfo(this.logger, '✅ Approved')
      return result
    } catch (e) {
      throw toLedgerError(e)
    }
  }
}

// the Solana app parses a v1 message as v0 and fails with 0x6a80, even with blind signing
function assertLedgerTransactionVersion(messageBytes: ArrayLike<number>): void {
  const prefix = messageBytes[0] ?? 0
  if ((prefix & 0x80) !== 0 && (prefix & 0x7f) >= 1) {
    throw new Error(
      `Transaction version ${prefix & 0x7f} is not supported by the Ledger Solana app yet, ` +
        'see https://github.com/LedgerHQ/app-solana/issues/248',
    )
  }
}

export function toLedgerError(e: unknown): Error {
  if (!(e instanceof Error)) {
    return new Error(`Ledger device failure: ${String(e)}`)
  }
  let message: string | undefined
  const statusCode = (e as { statusCode?: unknown }).statusCode
  if (typeof statusCode === 'number') {
    message = LEDGER_STATUS_MESSAGES[statusCode]
  }
  if (e.name === 'LockedDeviceError') {
    message = LOCKED
  } else if (e.message.includes('enabling blind signature')) {
    message =
      'Solana application does not permit blind signatures. ' +
      'Please, enable it in the Solana app settings on the Ledger device first.'
  } else if (e.message.includes('Invalid channel')) {
    message =
      'Ledger device seems not being acknowledged to have opened the manager. ' +
      'Please, open ledger manager first on your device.'
  } else if (e.message.includes('read from a closed HID')) {
    message =
      'Ledger device cannot be open, it seems to be closed. Ensure no other program uses it.'
  }
  return message === undefined ? e : new Error(message, { cause: e })
}

async function loadLedgerModules(): Promise<{
  Solana: typeof Solana
  TransportNodeHid: typeof TransportNodeHid
  getDevices: typeof getDevices
}> {
  try {
    const [solanaModule, transportModule] = await Promise.all([
      import('@ledgerhq/hw-app-solana'),
      import('@ledgerhq/hw-transport-node-hid-noevents'),
    ])
    return {
      Solana: solanaModule.default,
      TransportNodeHid: transportModule.default,
      getDevices: transportModule.getDevices,
    }
  } catch (e) {
    throw new Error(
      'Ledger support requires packages @ledgerhq/hw-app-solana and ' +
        '@ledgerhq/hw-transport-node-hid-noevents to be installed',
      { cause: e },
    )
  }
}

async function openLedgerDevices(): Promise<LedgerDevice[]> {
  const { Solana, TransportNodeHid, getDevices } = await loadLedgerModules()
  const devices: LedgerDevice[] = []
  // node-hid device type is not part of the transport typings
  for (const { path } of getDevices() as { path?: string }[]) {
    if (path === undefined) {
      continue
    }
    let transport = IN_LIB_TRANSPORT_CACHE.get(path)
    if (transport === undefined) {
      const opened = await TransportNodeHid.open(path)
      scheduleOnExit(() => {
        opened.close().catch(() => {
          /* ignore errors on closing transport */
        })
      })
      IN_LIB_TRANSPORT_CACHE.set(path, opened)
      transport = opened
    }
    devices.push(new LedgerDevice(new Solana(transport)))
  }
  return devices
}
