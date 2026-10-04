import { PublicKey } from '@solana/web3.js'

import {
  WalletType,
  formatDerivationPath,
  generateAllCombinations,
  getHeuristicDepthAndWide,
  isHardwareWalletUrl,
  parseWalletUrl,
  toHardenedPath,
} from '../src/url'

const PUBKEY = 'GontTwDeBduvbW85oHyC8A7GekuT8X1NkZHDDdUWWvsV'

describe('parseWalletUrl', () => {
  it.each([
    ['usb://ledger', WalletType.LEDGER, undefined, [], false],
    ['usb://trezor', WalletType.TREZOR, undefined, [], false],
    [
      'usb://ledger?key=1234/5678',
      WalletType.LEDGER,
      undefined,
      [1234, 5678],
      true,
    ],
    ['usb://trezor?key=0/0', WalletType.TREZOR, undefined, [0, 0], true],
    [`usb://ledger/${PUBKEY}`, WalletType.LEDGER, PUBKEY, [], false],
    [`usb://trezor/${PUBKEY}/`, WalletType.TREZOR, PUBKEY, [], false],
    [`usb://ledger/${PUBKEY}?key=0`, WalletType.LEDGER, PUBKEY, [0], true],
    [
      `usb://ledger/${PUBKEY}?key=/0/0`,
      WalletType.LEDGER,
      PUBKEY,
      [0, 0],
      true,
    ],
    [
      `usb://ledger/${PUBKEY}?key=0'/1'`,
      WalletType.LEDGER,
      PUBKEY,
      [0, 1],
      true,
    ],
    [
      `usb://ledger/${PUBKEY}?key=0h/1h`,
      WalletType.LEDGER,
      PUBKEY,
      [0, 1],
      true,
    ],
    [
      `usb://ledger/${PUBKEY}?key=0/ 1/ 3`,
      WalletType.LEDGER,
      PUBKEY,
      [0, 1, 3],
      true,
    ],
    [`usb://ledger/${PUBKEY}?key=`, WalletType.LEDGER, PUBKEY, [], false],
    [
      `usb://ledger/${PUBKEY}?key=44/501/1/2/3`,
      WalletType.LEDGER,
      PUBKEY,
      [1, 2, 3],
      true,
    ],
    [
      `usb://ledger/${PUBKEY}?key=44'/501'/0'/0'`,
      WalletType.LEDGER,
      PUBKEY,
      [0, 0],
      true,
    ],
    ["usb://trezor?key=m/44'/501'/2'", WalletType.TREZOR, undefined, [2], true],
    ["usb://ledger?key=44'/501'", WalletType.LEDGER, undefined, [], true],
    ['  usb://Ledger?key=3  ', WalletType.LEDGER, undefined, [3], true],
  ])('parses %s', (url, walletType, walletId, derivationPath, explicitKey) => {
    expect(parseWalletUrl(url)).toEqual({
      walletType,
      walletId: walletId === undefined ? undefined : new PublicKey(walletId),
      derivationPath,
      explicitKey,
    })
  })

  it.each([
    ['invalid-url', 'Invalid hardware wallet url'],
    ['m/44/501/0/0', 'Invalid hardware wallet url'],
    ['usb://rosie-cotton?key=0', 'Invalid hardware wallet url'],
    ['usb://ledgerx', 'Invalid hardware wallet url'],
    ['usb://ledger/elanor?key=0', 'Expecting the "elanor" being pubkey'],
    ['usb://trezor/elanor', 'Expecting the "elanor" being pubkey'],
    [`usb://ledger/${PUBKEY}/${PUBKEY}`, 'single pubkey'],
    [
      `usb://ledger/${PUBKEY}?samwise-gamgee=0`,
      'Only a single query parameter "key"',
    ],
    [`usb://ledger?${PUBKEY}`, 'Only a single query parameter "key"'],
    ['usb://ledger?key=0/0&foo=1', 'Only a single query parameter "key"'],
    ['usb://ledger?key=0&key=1', 'Only a single query parameter "key"'],
    [`usb://trezor/${PUBKEY}?key=0/gaffer`, 'being a set of numbers delimited'],
    ['usb://trezor?key=-1', 'being a set of numbers delimited'],
    ['usb://ledger?key=2147483648', 'being a set of numbers delimited'],
  ])('rejects %s', (url, message) => {
    expect(() => parseWalletUrl(url)).toThrow(message)
  })
})

describe('derivation path', () => {
  it('formats all indexes hardened', () => {
    expect(formatDerivationPath([])).toEqual("44'/501'")
    expect(formatDerivationPath([0, 1])).toEqual("44'/501'/0'/1'")
  })

  it('creates hardened index path', () => {
    expect(toHardenedPath([0, 5])).toEqual([
      0x8000002c, 0x800001f5, 0x80000000, 0x80000005,
    ])
  })

  it('detects hardware wallet url', () => {
    expect(isHardwareWalletUrl(' USB://trezor')).toBe(true)
    expect(isHardwareWalletUrl('/home/user/.config/solana/id.json')).toBe(false)
  })
})

describe('account search heuristics', () => {
  it('generates combinations', () => {
    expect(generateAllCombinations(2, 2)).toEqual([
      [],
      [0],
      [1],
      [2],
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 0],
      [2, 1],
      [2, 2],
    ])
    expect(generateAllCombinations(0, 3)).toEqual([[], [0], [0, 0], [0, 0, 0]])
    expect(generateAllCombinations(1, 3)).toHaveLength(1 + 2 + 4 + 8)
  })

  it('widens search span by requested derivation path', () => {
    expect(getHeuristicDepthAndWide([])).toEqual({ depth: 20, wide: 2 })
    expect(getHeuristicDepthAndWide([0, 15])).toEqual({ depth: 20, wide: 2 })
    expect(getHeuristicDepthAndWide([0, 30])).toEqual({ depth: 30, wide: 2 })
    expect(getHeuristicDepthAndWide([1, 0, 0])).toEqual({ depth: 20, wide: 3 })
    expect(getHeuristicDepthAndWide([6, 7], 1, 1)).toEqual({
      depth: 7,
      wide: 2,
    })
    expect(getHeuristicDepthAndWide([], 0, 0)).toEqual({ depth: 0, wide: 0 })
  })
})
