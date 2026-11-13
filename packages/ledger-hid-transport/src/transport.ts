import { constants } from 'fs'
import { access } from 'fs/promises'

import { identifyUSBProductId, ledgerUSBVendorId } from '@ledgerhq/devices'
import { version as devicesVersion } from '@ledgerhq/devices/package.json'
import Transport from '@ledgerhq/hw-transport'
import {
  CantOpenDevice,
  DisconnectedDevice,
  DisconnectedDeviceDuringOperation,
} from '@ledgerhq/hw-transport/errors'
import { HIDAsync, devicesAsync } from 'node-hid'

import { createResponseDecoder, encodeApdu } from './framing'

import type { DeviceModelId } from '@ledgerhq/devices'
import type { Device } from 'node-hid'

const LEDGER_USAGE_PAGE = 0xffa0
const REPORT_ID = Buffer.from([0x00])
// bounded reads, node-hid 3 cannot interrupt a blocking read and it would stall close
const READ_SLICE_MS = 1000
const UDEV_RULES_URL = 'https://github.com/LedgerHQ/udev-rules'
const DISCONNECTED = 'Ledger device is disconnected, reconnect it and retry'
const DISCONNECTED_DURING_OPERATION =
  'Ledger device was disconnected during the operation, reconnect it and retry'

export type TransportLogger = (message: string) => void

export type LedgerHidDevice = {
  path: string
  productId: number
  model?: DeviceModelId
}

// hidapi on Linux did not always report usage pages, the legacy transport selected interface 0 there
function isApduInterface(device: Device): boolean {
  return (
    device.usagePage === LEDGER_USAGE_PAGE ||
    (process.platform === 'linux' && device.interface === 0)
  )
}

export async function getDevices({
  logger,
}: { logger?: TransportLogger } = {}): Promise<LedgerHidDevice[]> {
  const devices = new Map<string, LedgerHidDevice>()
  for (const device of await devicesAsync(ledgerUSBVendorId, 0)) {
    const { path, productId } = device
    if (path === undefined || devices.has(path) || !isApduInterface(device)) {
      continue
    }
    const model = identifyUSBProductId(productId)?.id
    if (model === undefined) {
      logger?.(
        `Ledger device ${path} productId 0x${productId.toString(16)} ` +
          `is not a model known to @ledgerhq/devices ${devicesVersion}`,
      )
    }
    devices.set(path, { path, productId, model })
  }
  return [...devices.values()]
}

export default class TransportNodeHid extends Transport {
  private readonly channel = Math.floor(Math.random() * 0xffff)
  private closed = false

  private constructor(
    private readonly device: HIDAsync,
    private readonly logger: TransportLogger | undefined,
  ) {
    super()
  }

  // the base declares open(descriptor, timeoutMs), this signature comes first for callers
  static override readonly open = (async (
    path: string,
    { logger }: { logger?: TransportLogger } = {},
  ): Promise<TransportNodeHid> => {
    let device: HIDAsync
    try {
      device = await HIDAsync.open(path, { nonExclusive: true })
    } catch (e) {
      throw await cantOpenDevice(path, e)
    }
    return new TransportNodeHid(device, logger)
  }) as ((
    path: string,
    options?: { logger?: TransportLogger },
  ) => Promise<TransportNodeHid>) &
    typeof Transport.open

  override async exchange(apdu: Buffer): Promise<Buffer> {
    return this.exchangeAtomicImpl(async () => {
      if (this.closed) {
        throw new DisconnectedDevice(DISCONNECTED)
      }
      const frames = encodeApdu(apdu, this.channel)
      this.logger?.(`=> ${apdu.toString('hex')}`)
      try {
        await this.drain()
        for (const frame of frames) {
          await this.io(this.device.write(Buffer.concat([REPORT_ID, frame])))
        }
        const response = await this.readResponse()
        this.logger?.(`<= ${response.toString('hex')}`)
        return response
      } catch (e) {
        await this.disconnect()
        throw e
      }
    })
  }

  override async close(): Promise<void> {
    await this.exchangeBusyPromise
    if (!this.closed) {
      this.closed = true
      await this.device.close()
    }
  }

  private async readResponse(): Promise<Buffer> {
    const decode = createResponseDecoder(this.channel)
    for (;;) {
      const frame = await this.io(this.device.read(READ_SLICE_MS))
      const response =
        frame === undefined || frame.length === 0 ? undefined : decode(frame)
      if (response !== undefined) {
        return response
      }
    }
  }

  private async drain(): Promise<void> {
    let frame: Buffer | undefined
    do {
      frame = await this.io(this.device.read(0))
    } while (frame !== undefined && frame.length > 0)
  }

  private async io<T>(operation: Promise<T>): Promise<T> {
    try {
      return await operation
    } catch (e) {
      throw withCause(
        new DisconnectedDeviceDuringOperation(DISCONNECTED_DURING_OPERATION),
        e,
      )
    }
  }

  // no request id in the protocol, a late response must never answer the next request
  private async disconnect(): Promise<void> {
    if (this.closed) {
      return
    }
    this.closed = true
    await this.device.close().catch(() => {
      /* the device is gone already */
    })
    this.emit('disconnect')
  }
}

async function cantOpenDevice(
  path: string,
  cause: unknown,
): Promise<CantOpenDevice> {
  const reason = (await isPermissionDenied(path))
    ? `permission denied. Install the Ledger udev rules: ${UDEV_RULES_URL}`
    : cause instanceof Error
      ? cause.message
      : String(cause)
  return withCause(
    new CantOpenDevice(`Cannot open Ledger device ${path}: ${reason}`),
    cause,
  )
}

async function isPermissionDenied(path: string): Promise<boolean> {
  if (process.platform !== 'linux') {
    return false
  }
  try {
    await access(path, constants.R_OK | constants.W_OK)
    return false
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EACCES'
  }
}

function withCause<E extends Error>(error: E, cause: unknown): E {
  return Object.assign(error, { cause })
}
