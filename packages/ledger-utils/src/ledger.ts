import Solana from '@ledgerhq/hw-app-solana'
import TransportNodeHid, {
  getDevices,
} from '@ledgerhq/hw-transport-node-hid-noevents'
import {
  MessageV0,
  PublicKey,
  Message,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js'
import { generateAllCombinations } from './utils'
import {
  LoggerPlaceholder,
  logDebug,
  logInfo,
  scheduleOnExit,
} from '@marinade.finance/ts-common'

export const CLI_LEDGER_URL_PREFIX = 'usb://ledger'
export const SOLANA_LEDGER_BIP44_BASE_PATH = "44'/501'"
export const SOLANA_LEDGER_BIP44_BASE_REGEXP = /^44[']{0,1}\/501[']{0,1}\//
export const DEFAULT_DERIVATION_PATH = SOLANA_LEDGER_BIP44_BASE_PATH

const IN_LIB_TRANSPORT_CACHE: Map<string, TransportNodeHid> = new Map()

/**
 * Wallet interface for objects that can be used to sign provider transactions.
 * The interface is compatible with @coral-xyz/anchor/dist/cjs/provider in version 0.28.0
 * See https://github.com/coral-xyz/anchor/blob/v0.28.0/ts/packages/anchor/src/provider.ts#L344
 */
export interface Wallet {
  signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T
  ): Promise<T>
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[]
  ): Promise<T[]>
  publicKey: PublicKey
}

export class LedgerWallet implements Wallet {
  /**
   * "Constructor" of Solana Ledger to be opened and worked as a Wallet.
   * From ledger url in format of usb://ledger[/<pubkey>[?key=<number>]
   * creates wrapper class around Solana ledger device from '@ledgerhq/hw-app-solana' package.
   */
  static async instance(
    ledgerUrl = '0',
    logger: LoggerPlaceholder | undefined = undefined
  ): Promise<LedgerWallet> {
    // parsedPubkey could be undefined when not provided in url string
    const { parsedPubkey, parsedDerivedPath } = parseLedgerUrl(ledgerUrl)

    const { api, pubkey, derivedPath } = await LedgerWallet.getSolanaApi(
      parsedPubkey,
      parsedDerivedPath,
      logger
    )
    return new LedgerWallet(api, derivedPath, pubkey, logger)
  }

  private constructor(
    public readonly solanaApi: Solana,
    public readonly derivedPath: string,
    public readonly publicKey: PublicKey,
    public readonly logger: LoggerPlaceholder | undefined = undefined
  ) {}

  public async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T
  ): Promise<T> {
    let message: Message | MessageV0
    if (tx instanceof Transaction) {
      message = tx.compileMessage()
    } else {
      message = tx.message
    }
    logInfo(
      this.logger,
      `Waiting for your approval on Ledger hardware wallet ${
        this.derivedPath
      } [[${this.publicKey.toBase58()}]]`
    )
    const signature = await this.signMessage(message)
    tx.addSignature(this.publicKey, signature)
    logInfo(this.logger, '✅ Approved')
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

  /**
   * Based on the provided pubkey and derived path
   * it tries to match the ledger device and returns back the Solana API.
   * If pubkey is undefined, it takes the first ledger device.
   *
   * When the `heuristicDepth` and `heuristicWide` are provided,
   * then the derivation path will be searched through the space of all combinations
   * of the provided depth and wide. E.g., when the depth is 10 and wide is 3,
   * then the derivation path will be searched from `44'/501'`, through `44'/501'/0 until `44'/501'/10/10/10`.
   */
  private static async getSolanaApi(
    pubkey: PublicKey | undefined,
    derivedPath: string,
    logger: LoggerPlaceholder | undefined = undefined,
    heuristicDepth: number | undefined = 10,
    heuristicWide: number | undefined = 3
  ): Promise<{ api: Solana; derivedPath: string; pubkey: PublicKey }> {
    const ledgerDevices = getDevices()
    if (ledgerDevices.length === 0) {
      throw new Error('No ledger device found')
    }

    let transport: TransportNodeHid | undefined = undefined
    if (pubkey === undefined) {
      // we don't know where to search for the derived path and thus taking first device
      // we will search for the provided derived path at this first device when signing message
      // when pubkey is defined we search all available devices to find a match of pubkey and derived path
      transport = (await openTransports(ledgerDevices[0]))[0]
    } else {
      const openedTransports = await openTransports(...ledgerDevices)
      // if derived path is provided let's check if matches the pubkey
      for (const openedTransport of openedTransports) {
        const solanaApi = new Solana(openedTransport)
        const ledgerPubkey = await getPublicKey(solanaApi, derivedPath)
        if (ledgerPubkey.equals(pubkey)) {
          transport = openedTransport
          break // the found transport is the one we need
        }
      }
      if (transport === undefined) {
        logInfo(
          logger,
          `Public key ${pubkey.toBase58()} has not been found at the default or provided ` +
            `derivation path ${derivedPath}. Going to search, it will take a while...`
        )
        const { depth, wide } = getHeuristicDepthAndWide(
          derivedPath,
          heuristicDepth,
          heuristicWide
        )
        const searchedData = await searchDerivedPathFromPubkey(
          pubkey,
          logger,
          depth,
          wide
        )
        if (searchedData !== null) {
          transport = searchedData.transport
          derivedPath = searchedData.derivedPath
          logInfo(
            logger,
            `For public key ${pubkey.toBase58()} has been found derived path ${derivedPath}`
          )
        }
      }
    }

    if (transport === undefined) {
      throw new Error(
        'Available ledger devices does not provide pubkey ' +
          `'${pubkey?.toBase58()}' for derivation path '${derivedPath}'`
      )
    }

    const api = new Solana(transport)
    pubkey = await getPublicKey(api, derivedPath)
    return { api, derivedPath, pubkey }
  }

  /**
   * Signing versioned transaction message with ledger
   * and returns back the signature that's to be included into versioned transaction creation.
   * ```ts
   * new VersionedTransaction(
   *   message,
   *   [ signature ]
   * )
   * ```
   */
  private async signMessage(message: MessageV0 | Message): Promise<Buffer> {
    logDebug(
      this.logger,
      'signing message with pubkey ' +
        (await getPublicKey(this.solanaApi, this.derivedPath)).toBase58() +
        ` of derived path ${this.derivedPath}`
    )
    const { signature } = await this.solanaApi.signTransaction(
      this.derivedPath,
      Buffer.from(message.serialize())
    )
    return signature
  }
}

/**
 * From provided Solana API and derived path
 * it returns the public key of the derived path.
 */
export async function getPublicKey(
  solanaApi: Solana,
  derivedPath: string
): Promise<PublicKey> {
  const { address: bufAddress } = await solanaApi.getAddress(derivedPath)
  return new PublicKey(bufAddress)
}

export async function searchDerivedPathFromPubkey(
  pubkey: PublicKey,
  logger: LoggerPlaceholder | undefined = undefined,
  heuristicDepth: number | undefined = 10,
  heuristicWide: number | undefined = 3
): Promise<{
  derivedPath: string
  solanaApi: Solana
  transport: TransportNodeHid
} | null> {
  const ledgerDevices = getDevices()
  if (ledgerDevices.length === 0) {
    throw new Error('No ledger device found')
  }
  const openedTransports = await openTransports(...ledgerDevices)

  const heuristicsCombinations: number[][] = generateAllCombinations(
    heuristicDepth,
    heuristicWide
  )

  for (const transport of openedTransports) {
    const solanaApi = new Solana(transport)
    for (const combination of heuristicsCombinations) {
      const strCombination = combination.map(v => v.toString())
      strCombination.unshift(SOLANA_LEDGER_BIP44_BASE_PATH)
      const heuristicDerivedPath = strCombination.join('/')

      logDebug(logger, `search loop: ${heuristicDerivedPath}`)
      const ledgerPubkey = await getPublicKey(solanaApi, heuristicDerivedPath)
      if (ledgerPubkey.equals(pubkey)) {
        logDebug(
          logger,
          `Found path ${heuristicDerivedPath}, pubkey ${pubkey.toBase58()}`
        )
        return { derivedPath: heuristicDerivedPath, solanaApi, transport }
      }
    }
  }
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function openTransports(...devices: any[]): Promise<TransportNodeHid[]> {
  const transports: TransportNodeHid[] = []
  for (const device of devices) {
    let transport = IN_LIB_TRANSPORT_CACHE.get(device.path)
    if (transport === undefined) {
      transport = await TransportNodeHid.open(device.path)
      scheduleTransportCloseOnExit(transport)
      IN_LIB_TRANSPORT_CACHE.set(device.path, transport)
    }
    transports.push(transport)
  }
  return transports
}

/**
 * Trying to close all provided transports in case of abrupt exit, or just exit
 * (ignoring errors when closing the transport).
 *
 * @param transports set of transport to be closed on exit
 */
function scheduleTransportCloseOnExit(...transports: TransportNodeHid[]): void {
  scheduleOnExit(() => {
    for (const openedTransport of transports) {
      try {
        openedTransport.close()
      } catch (e) {
        // ignore error and go to next transport
      }
    }
  })
}
