import { Connection, Finality, PublicKey } from '@solana/web3.js'
import { Logger } from 'pino'
import {
  Context,
  parseClusterUrl,
  getContext,
  parseCommitment,
  setContext,
  parseConfirmationFinality,
} from '@marinade.finance/cli-common'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'

export class CliContext extends Context {
  readonly _connection: Connection

  constructor({
    connection,
    wallet,
    logger,
    simulate,
    printOnly,
    skipPreflight,
    confirmationFinality,
    computeUnitPrice,
    commandName,
  }: {
    connection: Connection
    wallet: WalletInterface
    logger: Logger
    simulate: boolean
    printOnly: boolean
    skipPreflight: boolean
    confirmationFinality: Finality
    computeUnitPrice: number
    commandName: string
  }) {
    super({
      wallet,
      logger,
      skipPreflight,
      simulate,
      printOnly,
      commandName,
      computeUnitPrice,
      confirmationFinality,
    })
    this._connection = connection
  }

  get connection() {
    return this._connection
  }
}

export function setCliContext({
  cluster,
  wallet,
  programId,
  simulate,
  printOnly,
  skipPreflight,
  commitment,
  confirmationFinality,
  computeUnitPrice,
  logger,
  command,
}: {
  cluster: string
  wallet: WalletInterface
  programId?: PublicKey
  simulate: boolean
  printOnly: boolean
  skipPreflight: boolean
  commitment: string
  confirmationFinality: string
  computeUnitPrice: number
  logger: Logger
  command: string
}) {
  try {
    const parsedCommitment = parseCommitment(commitment)
    const clusterUrl = parseClusterUrl(cluster)
    const connection = new Connection(clusterUrl, parsedCommitment)

    // this is kind of a workaround how to manage timeouts in the CLI
    // for mainnet-beta public API, adding wait time for confirmation
    const confirmWaitTime = clusterUrl.includes('api.mainnet') ? 4000 : 0

    setContext(
      new CliContext({
        connection,
        wallet,
        logger,
        simulate,
        printOnly,
        skipPreflight,
        confirmationFinality: parseConfirmationFinality(confirmationFinality),
        confirmWaitTime,
        computeUnitPrice,
        commandName: command,
      })
    )
    logger.debug(
      `RPC url: ${clusterUrl}, keypair: ${wallet.publicKey.toBase58()}`
    )
  } catch (e) {
    logger.debug(e)
    throw new Error(`Failed to connect Solana cluster at ${cluster}`)
  }
}

export function getCliContext(): CliContext {
  return getContext() as CliContext
}
