import { logDebug, logInfo } from '@marinade.finance/ts-common'

import {
  formatDerivationPath,
  generateAllCombinations,
  getHeuristicDepthAndWide,
} from './url'

import type { WalletType } from './url'
import type { LoggerPlaceholder } from '@marinade.finance/ts-common'
import type { PublicKey } from '@solana/web3.js'

export interface HardwareDevice {
  getPublicKey(derivationPath: number[]): Promise<PublicKey>
}

export async function resolveDevice<D extends HardwareDevice>({
  walletType,
  devices,
  walletId,
  derivationPath,
  explicitKey,
  logger,
}: {
  walletType: WalletType
  devices: D[]
  walletId: PublicKey | undefined
  derivationPath: number[]
  explicitKey: boolean
  logger: LoggerPlaceholder | undefined
}): Promise<{ device: D; derivationPath: number[] }> {
  const [firstDevice] = devices
  if (firstDevice === undefined) {
    throw new Error(`No ${walletType} device found`)
  }

  if (walletId === undefined) {
    if (devices.length > 1) {
      const ids = await Promise.all(devices.map(d => d.getPublicKey([])))
      throw new Error(
        `Multiple ${walletType} devices found, select one by wallet id: ` +
          ids.map(id => `usb://${walletType}/${id.toBase58()}`).join(', '),
      )
    }
    return { device: firstDevice, derivationPath }
  }

  const deviceErrors: unknown[] = []
  for (const device of devices) {
    try {
      if ((await device.getPublicKey([])).equals(walletId)) {
        return { device, derivationPath }
      }
      if (
        derivationPath.length > 0 &&
        (await device.getPublicKey(derivationPath)).equals(walletId)
      ) {
        return { device, derivationPath }
      }
    } catch (e) {
      logDebug(logger, `Failed to read ${walletType} device: ${String(e)}`)
      deviceErrors.push(e)
    }
  }

  if (!explicitKey) {
    const searched = await searchDerivationPath({
      devices,
      walletId,
      derivationPath,
      logger,
    })
    if (searched !== null) {
      return searched
    }
  }

  if (deviceErrors.length === devices.length) {
    throw deviceErrors[0]
  }
  throw new Error(
    `No ${walletType} device provides pubkey ${walletId.toBase58()} ` +
      `as wallet id (${formatDerivationPath([])}) nor at derivation path ${formatDerivationPath(derivationPath)}`,
  )
}

async function searchDerivationPath<D extends HardwareDevice>({
  devices,
  walletId,
  derivationPath,
  logger,
}: {
  devices: D[]
  walletId: PublicKey
  derivationPath: number[]
  logger: LoggerPlaceholder | undefined
}): Promise<{ device: D; derivationPath: number[] } | null> {
  logInfo(
    logger,
    `Public key ${walletId.toBase58()} has not been found at derivation path ` +
      `${formatDerivationPath(derivationPath)}. Going to search, it will take a while...`,
  )
  const { depth, wide } = getHeuristicDepthAndWide(derivationPath)
  const combinations = generateAllCombinations(depth, wide).filter(
    c => c.length > 0,
  )
  for (const device of devices) {
    for (const combination of combinations) {
      let pubkey: PublicKey
      try {
        pubkey = await device.getPublicKey(combination)
      } catch {
        break
      }
      if (pubkey.equals(walletId)) {
        logInfo(
          logger,
          `For public key ${walletId.toBase58()} has been found derivation path ${formatDerivationPath(combination)}`,
        )
        return { device, derivationPath: combination }
      }
    }
  }
  return null
}
