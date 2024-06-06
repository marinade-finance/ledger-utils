#!/usr/bin/env node

/* eslint-disable no-process-exit */
import { Command } from 'commander'
import {
  configureLogger,
  parsePubkey,
  parseWalletFromOpts,
  DEFAULT_KEYPAIR_PATH,
} from '@marinade.finance/cli-common'
import { Logger } from 'pino'
import { installCommand } from './trezor'

export const logger: Logger = configureLogger()
const program = new Command()

program
  .version('1.3.6')
  .allowExcessArguments(false)
  .configureHelp({ showGlobalOptions: true })
  .option(
    '-k, --keypair <keypair-or-ledger>',
    'Wallet keypair (path or ledger url in format usb://ledger/[<pubkey>][?key=<derivedPath>]). ' +
      'Wallet keypair is used to pay for the transaction fees and as default value for signers. ' +
      `(default: loaded from solana config file or ${DEFAULT_KEYPAIR_PATH})`
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

    const printOnly = Boolean(command.opts().printOnly)
    const walletInterface = await parseWalletFromOpts(
      command.opts().keypair,
      printOnly,
      command.args,
      logger
    )
  })

installCommand(program)

program.parseAsync(process.argv).then(
  () => {
    logger.debug({ resolution: 'Success', args: process.argv })
  },
  (err: unknown) => {
    logger.error({ resolution: 'Failure', err, args: process.argv })
    process.exit(200)
  }
)
