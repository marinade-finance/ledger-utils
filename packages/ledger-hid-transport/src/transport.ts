import { identifyUSBProductId, ledgerUSBVendorId } from '@ledgerhq/devices'
import { version as devicesVersion } from '@ledgerhq/devices/package.json'
import { devicesAsync } from 'node-hid'

import type { DeviceModelId } from '@ledgerhq/devices'
import type { Device } from 'node-hid'

const LEDGER_USAGE_PAGE = 0xffa0

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
