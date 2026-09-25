#!/usr/bin/env node

/* eslint-disable no-process-exit */
import { Command } from 'commander'
import {
  configureLogger,
  parseWalletFromOpts,
} from '@marinade.finance/cli-common'
import { Logger } from 'pino'

export const logger: Logger = configureLogger()
const program = new Command()

program
  .version('0.0.1')
  .allowExcessArguments(false)
  .configureHelp({ showGlobalOptions: true })
  .requiredOption(
    '-w, --wallet <wallet-url>',
    'Wallet url path(ledger or trezor in format usb://ledger|trezor/[<pubkey>][?key=<derivedPath>])'
  )
  .option(
    '-d, --debug',
    'Printing more detailed information of the CLI execution',
    false
  )
  .option('-v, --verbose', 'alias for --debug', false)
  .hook('preAction', async (command: Command, action: Command) => {
    if (command.opts().debug || command.opts().verbose) {
      logger.level = 'debug'
    }

    setCliContext({
      cluster: (command.opts().url ?? command.opts().cluster) as string,
      wallet: walletInterface,
      programId: await command.opts().programId,
      simulate: Boolean(command.opts().simulate),
      printOnly: false,
      skipPreflight: Boolean(command.opts().skipPreflight),
      commitment: command.opts().commitment,
      confirmationFinality: command.opts().confirmationFinality,
      computeUnitPrice: command.opts().withComputeUnitPrice,
      logger,
      command: action.name(),
    })
  })

installShow(program)

program.parseAsync(process.argv).then(
  () => {
    logger.debug({ resolution: 'Success', args: process.argv })
  },
  (err: unknown) => {
    logger.error({ resolution: 'Failure', err, args: process.argv })
    process.exit(200)
  }
)
