import { Command } from 'commander'


  export function installCommand(program: Command) {
    program
      .command('test')
      .action(
        async (
          something?: string
        ) => {
          await testWallet({
            something
          })
        }
      )
  }

  async function testWallet({
    something,
  }: {
    something?: string
  }) {
    console.log('test', something)
  }