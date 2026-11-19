import { logDebug, logInfo } from '@marinade.finance/ts-common'

import {
  formatDerivationPath,
  generateAllCombinations,
  getHeuristicDepthAndWide,
} from './url'

import type { WalletType } from './url'
import type { LoggerPlaceholder } from '@marinade.finance/ts-common'
import type { Address } from '@solana/addresses'

export interface HardwareDevice {
  getAddress(derivationPath: number[]): Promise<Address>
}

export async function resolveDevice<D extends HardwareDevice>({
  walletType,
  devices,
  walletId,
  derivationPath,
  explicitKey,
  logger,
  unopened = [],
}: {
  walletType: WalletType
  devices: D[]
  walletId: Address | undefined
  derivationPath: number[]
  explicitKey: boolean
  logger: LoggerPlaceholder | undefined
  unopened?: unknown[]
}): Promise<{ device: D; derivationPath: number[] }> {
  const [firstDevice] = devices
  if (firstDevice === undefined) {
    if (unopened.length > 0) {
      throw unopened[0]
    }
    throw new Error(`No ${walletType} device found`)
  }

  if (walletId === undefined) {
    if (devices.length + unopened.length > 1) {
      const ids = await Promise.allSettled(devices.map(d => d.getAddress([])))
      const unreadable =
        ids.filter(id => id.status === 'rejected').length + unopened.length
      throw new Error(
        `Multiple ${walletType} devices found, select one by wallet id: ` +
          ids
            .flatMap(id =>
              id.status === 'fulfilled'
                ? [`usb://${walletType}/${id.value}`]
                : [],
            )
            .join(', ') +
          (unreadable > 0
            ? ` (${unreadable} more device${unreadable > 1 ? 's' : ''} cannot be read)`
            : ''),
      )
    }
    return { device: firstDevice, derivationPath }
  }

  const deviceErrors = new Map<D, unknown>()
  for (const device of devices) {
    try {
      if ((await device.getAddress([])) === walletId) {
        return { device, derivationPath }
      }
      if (
        derivationPath.length > 0 &&
        (await device.getAddress(derivationPath)) === walletId
      ) {
        return { device, derivationPath }
      }
    } catch (e) {
      logDebug(logger, `Failed to read ${walletType} device: ${String(e)}`)
      deviceErrors.set(device, e)
    }
  }

  if (!explicitKey) {
    const searched = await searchDerivationPath({
      devices: devices.filter(d => !deviceErrors.has(d)),
      walletId,
      derivationPath,
      deviceErrors,
      logger,
    })
    if (searched !== null) {
      return searched
    }
  }

  const errors = [...unopened, ...deviceErrors.values()]
  const [firstError] = errors
  if (errors.length === devices.length + unopened.length) {
    throw firstError
  }
  throw new Error(
    `No ${walletType} device provides pubkey ${walletId} ` +
      `as wallet id (${formatDerivationPath([])}) nor at derivation path ${formatDerivationPath(derivationPath)}` +
      (firstError === undefined
        ? ''
        : `, ${errors.length} device${errors.length > 1 ? 's' : ''} cannot be read: ${String(errors[0])}`),
    { cause: firstError },
  )
}

async function searchDerivationPath<D extends HardwareDevice>({
  devices,
  walletId,
  derivationPath,
  deviceErrors,
  logger,
}: {
  devices: D[]
  walletId: Address
  derivationPath: number[]
  deviceErrors: Map<D, unknown>
  logger: LoggerPlaceholder | undefined
}): Promise<{ device: D; derivationPath: number[] } | null> {
  logInfo(
    logger,
    `Public key ${walletId} has not been found at derivation path ` +
      `${formatDerivationPath(derivationPath)}. Going to search, it will take a while...`,
  )
  const { depth, wide } = getHeuristicDepthAndWide(derivationPath)
  const combinations = generateAllCombinations(depth, wide).filter(
    c => c.length > 0,
  )
  for (const device of devices) {
    for (const combination of combinations) {
      let pubkey: Address
      try {
        pubkey = await device.getAddress(combination)
      } catch (e) {
        deviceErrors.set(device, e)
        break
      }
      if (pubkey === walletId) {
        logInfo(
          logger,
          `For public key ${walletId} has been found derivation path ${formatDerivationPath(combination)}`,
        )
        return { device, derivationPath: combination }
      }
    }
  }
  return null
}
