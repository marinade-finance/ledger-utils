import { Command } from 'commander'

export function installTrezor(program: Command) {
  const trezorCommand = program.command('trezor')

  trezorCommand.action(async (something?: string) => {
    await testWallet({
      something,
    })
  })
}

async function testWallet({ something }: { something?: string }) {
  console.log('test', something)
}
