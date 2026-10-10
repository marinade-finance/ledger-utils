import { logDebug } from '@marinade.finance/ts-common'

import { LedgerWallet } from './ledger'
import { TrezorWallet } from './trezor'
import { WalletType, isHardwareWalletUrl, parseWalletUrl } from './url'
import { toWeb3Wallet } from './web3js'

import type { HardwareWallet, Wallet } from './wallet'
import type { LoggerPlaceholder } from '@marinade.finance/ts-common'

export async function openHardwareWallet(
  url: string,
  logger?: LoggerPlaceholder,
): Promise<HardwareWallet> {
  const wallet =
    parseWalletUrl(url).walletType === WalletType.LEDGER
      ? await LedgerWallet.instance(url, logger)
      : await TrezorWallet.instance(url, logger)
  logDebug(
    logger,
    `Successfully connected to hardware wallet ${url} of key ${wallet.address}`,
  )
  return wallet
}

// null when the argument is not a usb:// url, so the caller falls back to a keypair file
export async function parseHardwareWallet(
  pathOrUrl: string,
  logger?: LoggerPlaceholder,
): Promise<Wallet | null> {
  const url = pathOrUrl.trim()
  if (!isHardwareWalletUrl(url)) {
    return null
  }
  return toWeb3Wallet(await openHardwareWallet(url, logger))
}
