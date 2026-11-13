import { parseHardwareWallet } from '../src/cli'

jest.mock('@ledgerhq/hw-app-solana', () => {
  throw new Error("Cannot find module '@ledgerhq/hw-app-solana'")
})
jest.mock('@trezor/connect', () => {
  throw new Error("Cannot find module '@trezor/connect'")
})

describe('parseHardwareWallet', () => {
  it('returns null for non hardware wallet argument', async () => {
    expect(await parseHardwareWallet('~/.config/solana/id.json')).toBeNull()
  })

  it('rejects malformed hardware wallet url', async () => {
    await expect(parseHardwareWallet('usb://keystone')).rejects.toThrow(
      'Supported wallets are ledger, trezor',
    )
  })

  it.each([
    [
      'usb://ledger',
      'Ledger support requires packages @ledgerhq/hw-app-solana',
    ],
    [' usb://trezor?key=0', 'Trezor support requires package @trezor/connect'],
  ])('names the missing optional package for %s', async (url, message) => {
    await expect(parseHardwareWallet(url)).rejects.toThrow(message)
  })
})
