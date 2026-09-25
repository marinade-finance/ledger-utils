import { fail } from 'assert'
import {
  generateAllCombinations,
  obtainAccountDiscoveryDepthAndWide,
  ParsedDerivedPath,
  parseWalletUrl,
  WalletType,
} from '../src'
import { PublicKey } from '@solana/web3.js'

describe('Ledger utils', () => {
  const BASE_SOLANA_BIP_URL = "44'/501'"

  it('generates combinations (depth=2, wide=2)', () => {
    const combinations = generateAllCombinations(2, 2)
    expect(combinations).toEqual([
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
  })

  it('generates combinations (depth=0, wide=1)', () => {
    const combinations = generateAllCombinations(0, 1)
    expect(combinations).toEqual([[], [0]])
  })

  it('generates combinations (depth=0, wide=5)', () => {
    const combinations = generateAllCombinations(0, 5)
    expect(combinations).toEqual([
      [],
      [0],
      [0, 0],
      [0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ])
    const combinationsUndefined = generateAllCombinations(100, undefined)
    expect(combinationsUndefined).toEqual([])
  })

  it('generates combinations (depth=1, wide=3)', () => {
    const combinations = generateAllCombinations(1, 3)
    expect(combinations).toEqual([
      [],
      [0],
      [1],
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
      [0, 1, 1],
      [1, 0, 0],
      [1, 0, 1],
      [1, 1, 0],
      [1, 1, 1],
    ])
    const combinationsUndefined = generateAllCombinations(100, undefined)
    expect(combinationsUndefined).toEqual([])
  })

  it('obtains account discovery span', () => {
    let { depth, wide } = obtainAccountDiscoveryDepthAndWide(
      'm/44/501/0/0',
      0,
      0
    )
    expect(depth).toEqual(0)
    expect(wide).toEqual(2)
    ;({ depth, wide } = obtainAccountDiscoveryDepthAndWide('44/501/0/0', 0, 0))
    expect(depth).toEqual(0)
    expect(wide).toEqual(2)
    ;({ depth, wide } = obtainAccountDiscoveryDepthAndWide('44/501/1', 20, 2))
    expect(depth).toEqual(20)
    expect(wide).toEqual(2)
    ;({ depth, wide } = obtainAccountDiscoveryDepthAndWide(
      '44/501/1/0/0',
      20,
      2
    ))
    expect(depth).toEqual(20)
    expect(wide).toEqual(3)
    ;({ depth, wide } = obtainAccountDiscoveryDepthAndWide(
      'm/44/501/1/0/0',
      1,
      4
    ))
    expect(depth).toEqual(1)
    expect(wide).toEqual(4)
    ;({ depth, wide } = obtainAccountDiscoveryDepthAndWide('44/501/0/15', 1, 2))
    expect(depth).toEqual(15)
    expect(wide).toEqual(2)
  })

  it('should get correct heuristic wide and depth', () => {
    expect(obtainAccountDiscoveryDepthAndWide("44/501/0'/0'/0'", 0, 0)).toEqual(
      {
        depth: 0,
        wide: 3,
      }
    )
    expect(obtainAccountDiscoveryDepthAndWide("44/501/0'/0'/0'", 5, 1)).toEqual(
      {
        depth: 5,
        wide: 3,
      }
    )
    expect(obtainAccountDiscoveryDepthAndWide("44/501/0'/0'/0'", 0, 4)).toEqual(
      {
        depth: 0,
        wide: 4,
      }
    )
    expect(obtainAccountDiscoveryDepthAndWide("44/501/0'/6'/0'", 1, 1)).toEqual(
      {
        depth: 6,
        wide: 3,
      }
    )
    expect(obtainAccountDiscoveryDepthAndWide("44/501/0'/6'/7'", 1, 1)).toEqual(
      {
        depth: 7,
        wide: 3,
      }
    )
    expect(
      obtainAccountDiscoveryDepthAndWide("44/501/8'/0'/0'/0'", 5, 10)
    ).toEqual({
      depth: 8,
      wide: 10,
    })
  })

  it('fail on wrong wallet url', () => {
    try {
      parseWalletUrl('m/44/501/0/0')
      fail('Expected failure as URL is in wrong format')
    } catch (e) {
      if (!(e as Error).message.includes('Invalid hardware wallet url')) {
        throw e
      }
    }

    try {
      parseWalletUrl('usb://rosie-cotton?key=0')
      fail('Expected failure as URL is in wrong format #2')
    } catch (e) {
      if (!(e as Error).message.includes('Invalid hardware wallet url')) {
        throw e
      }
    }

    const item = 'elanor'
    try {
      parseWalletUrl(`usb://ledger/${item}?key=0`)
      fail('Expected failure as URL is in wrong format #3.1')
    } catch (e) {
      if (
        !(e as Error).message.includes(`Expecting the "${item}" being pubkey`)
      ) {
        throw e
      }
    }
    try {
      parseWalletUrl(`usb://trezor/${item}?key=0`)
      fail('Expected failure as URL is in wrong format #3.2')
    } catch (e) {
      if (
        !(e as Error).message.includes(`Expecting the "${item}" being pubkey`)
      ) {
        throw e
      }
    }

    try {
      parseWalletUrl(
        'usb://ledger/2cTbf2TJy3BTuGqAbB5HRTLYeroBYnjvYmnvm23qFWPt?samwise-gamgee=0'
      )
      fail('Expected failure as URL is in wrong format #4.1')
    } catch (e) {
      if (!(e as Error).message.includes('Invalid wallet url')) {
        throw e
      }
    }
    try {
      parseWalletUrl(
        'usb://trezor/2cTbf2TJy3BTuGqAbB5HRTLYeroBYnjvYmnvm23qFWPt?samwise-gamgee=0'
      )
      fail('Expected failure as URL is in wrong format #4.2')
    } catch (e) {
      if (!(e as Error).message.includes('Invalid wallet url')) {
        throw e
      }
    }

    try {
      parseWalletUrl(
        'usb://ledger?2cTbf2TJy3BTuGqAbB5HRTLYeroBYnjvYmnvm23qFWPt'
      )
      fail('Expected failure as URL is in wrong format #5.1')
    } catch (e) {
      if (!(e as Error).message.includes('Invalid wallet url')) {
        throw e
      }
    }
    try {
      parseWalletUrl(
        'usb://trezor?2cTbf2TJy3BTuGqAbB5HRTLYeroBYnjvYmnvm23qFWPt'
      )
      fail('Expected failure as URL is in wrong format #5.2')
    } catch (e) {
      if (!(e as Error).message.includes('Invalid wallet url')) {
        throw e
      }
    }

    try {
      parseWalletUrl(
        'usb://trezor/2cTbf2TJy3BTuGqAbB5HRTLYeroBYnjvYmnvm23qFWPt?key=0/gaffer'
      )
      fail('Expected failure as URL is in wrong format #6')
    } catch (e) {
      if (!(e as Error).message.includes('being a set of numbers delimited')) {
        throw e
      }
    }
  })

  it('should parse a valid Ledger URL', () => {
    const url = 'usb://ledger?key=1234/5678'
    expect(parseWalletUrl(url)).toEqual({
      walletIdentifier: undefined,
      walletType: 'ledger',
      parsedDerivedPath: new ParsedDerivedPath([1234, 5678]),
    })

    const url2 = 'usb://ledger'
    expect(parseWalletUrl(url2)).toEqual({
      walletIdentifier: undefined,
      walletType: 'ledger',
      parsedDerivedPath: new ParsedDerivedPath([]),
    })

    const url3 = 'usb://ledger/GontTwDeBduvbW85oHyC8A7GekuT8X1NkZHDDdUWWvsV'
    expect(parseWalletUrl(url3)).toEqual({
      walletIdentifier: new PublicKey(
        'GontTwDeBduvbW85oHyC8A7GekuT8X1NkZHDDdUWWvsV'
      ),
      walletType: 'ledger',
      parsedDerivedPath: new ParsedDerivedPath([]),
    })

    const url4 =
      'usb://ledger/GontTwDeBduvbW85oHyC8A7GekuT8X1NkZHDDdUWWvsV?key=0'
    expect(parseWalletUrl(url4)).toEqual({
      walletIdentifier: new PublicKey(
        'GontTwDeBduvbW85oHyC8A7GekuT8X1NkZHDDdUWWvsV'
      ),
      walletType: 'ledger',
      parsedDerivedPath: new ParsedDerivedPath([0]),
    })

    const url6 =
      'usb://ledger/GontTwDeBduvbW85oHyC8A7GekuT8X1NkZHDDdUWWvsV?key=/0/0'
    expect(parseWalletUrl(url6)).toEqual({
      walletIdentifier: new PublicKey(
        'GontTwDeBduvbW85oHyC8A7GekuT8X1NkZHDDdUWWvsV'
      ),
      walletType: 'ledger',
      parsedDerivedPath: new ParsedDerivedPath([0, 0]),
    })

    const url7 =
      'usb://ledger/GontTwDeBduvbW85oHyC8A7GekuT8X1NkZHDDdUWWvsV?key='
    expect(parseWalletUrl(url7)).toEqual({
      walletIdentifier: new PublicKey(
        'GontTwDeBduvbW85oHyC8A7GekuT8X1NkZHDDdUWWvsV'
      ),
      walletType: 'ledger',
      parsedDerivedPath: new ParsedDerivedPath([]),
    })

    const url8 =
      'usb://ledger/GontTwDeBduvbW85oHyC8A7GekuT8X1NkZHDDdUWWvsV?key=44/501/1/2/3'
    expect(parseWalletUrl(url8)).toEqual({
      walletIdentifier: new PublicKey(
        'GontTwDeBduvbW85oHyC8A7GekuT8X1NkZHDDdUWWvsV'
      ),
      walletType: 'ledger',
      parsedDerivedPath: new ParsedDerivedPath([1, 2, 3]),
    })

    const url9 =
      "usb://ledger/GontTwDeBduvbW85oHyC8A7GekuT8X1NkZHDDdUWWvsV?key=44/501/0'/0'/0'"
    expect(parseWalletUrl(url9)).toEqual({
      walletIdentifier: new PublicKey(
        'GontTwDeBduvbW85oHyC8A7GekuT8X1NkZHDDdUWWvsV'
      ),
      walletType: 'ledger',
      parsedDerivedPath: new ParsedDerivedPath([0, 0, 0]),
    })
  })

  it('should throw an error for an invalid Ledger URL', () => {
    const url = 'invalid-url'
    expect(() => parseWalletUrl(url)).toThrow(
      'Invalid hardware wallet url prefix, provided url "invalid-url". Expected url started with "usb://". Supported wallets are trezor, ledger.'
    )
  })

  it('parsing wallet urls', () => {
    // -- only WALLET TYPE
    const parsedSoloTrezor = parseWalletUrl('usb://trezor')
    expect(parsedSoloTrezor.walletType).toEqual(WalletType.TREZOR)
    expect(parsedSoloTrezor.walletIdentifier).toBeUndefined()
    expect(parsedSoloTrezor.parsedDerivedPath.solanaBip).toEqual(
      BASE_SOLANA_BIP_URL
    )

    const parsedSoloLedger = parseWalletUrl('usb://ledger')
    expect(parsedSoloLedger.walletType).toEqual(WalletType.LEDGER)
    expect(parsedSoloLedger.walletIdentifier).toBeUndefined()
    expect(parsedSoloLedger.parsedDerivedPath.solanaBip).toEqual(
      BASE_SOLANA_BIP_URL
    )

    // -- with WALLET ID
    let walletId = 'q9XWcZ7T1wP4bW9SB4XgNNwjnFEJ982nE8aVbbNuwot'
    const parsedIdTrezor = parseWalletUrl('usb://trezor/' + walletId)
    expect(parsedIdTrezor.walletType).toEqual(WalletType.TREZOR)
    expect(parsedIdTrezor.walletIdentifier?.toBase58()).toEqual(walletId)
    expect(parsedIdTrezor.parsedDerivedPath.solanaBip).toEqual(
      BASE_SOLANA_BIP_URL
    )

    walletId = 'q9XWcZ7T1wP4bW9SB4XgNNwjnFEJ982nE8aVbbNuwot'
    const parsedIdLedger = parseWalletUrl('usb://ledger/' + walletId)
    expect(parsedIdLedger.walletType).toEqual(WalletType.LEDGER)
    expect(parsedIdLedger.walletIdentifier?.toBase58()).toEqual(walletId)
    expect(parsedIdLedger.parsedDerivedPath.solanaBip).toEqual(
      BASE_SOLANA_BIP_URL
    )

    // -- with KEY
    walletId = 'q9XWcZ7T1wP4bW9SB4XgNNwjnFEJ982nE8aVbbNuwot'
    let key: string | number = '0'
    const parsedKey1Trezor = parseWalletUrl(
      `usb://trezor/${walletId}?key=${key}`
    )
    expect(parsedKey1Trezor.walletType).toEqual(WalletType.TREZOR)
    expect(parsedKey1Trezor.walletIdentifier?.toBase58()).toEqual(walletId)
    expect(parsedKey1Trezor.parsedDerivedPath.solanaBip).toEqual(
      BASE_SOLANA_BIP_URL + '/' + key
    )

    walletId = 'FdtiepBtP98oU2uPNgAzUoGwggUDdRXwJH2KJo3oUaix'
    key = 2
    const parsedKey1Ledger = parseWalletUrl(
      `usb://ledger/${walletId}?key=${key}`
    )
    expect(parsedKey1Ledger.walletType).toEqual(WalletType.LEDGER)
    expect(parsedKey1Ledger.walletIdentifier?.toBase58()).toEqual(walletId)
    expect(parsedKey1Ledger.parsedDerivedPath.solanaBip).toEqual(
      BASE_SOLANA_BIP_URL + '/' + key
    )

    walletId = 'q9XWcZ7T1wP4bW9SB4XgNNwjnFEJ982nE8aVbbNuwot'
    key = '0/1'
    const parsedKey2Trezor = parseWalletUrl(
      `usb://trezor/${walletId}?key=${key}`
    )
    expect(parsedKey2Trezor.walletType).toEqual(WalletType.TREZOR)
    expect(parsedKey2Trezor.walletIdentifier?.toBase58()).toEqual(walletId)
    expect(parsedKey2Trezor.parsedDerivedPath.solanaBip).toEqual(
      BASE_SOLANA_BIP_URL + '/' + key
    )

    walletId = 'FdtiepBtP98oU2uPNgAzUoGwggUDdRXwJH2KJo3oUaix'
    key = '0/ 1/ 3'
    const parsedKey2Ledger = parseWalletUrl(
      `usb://ledger/${walletId}?key=${key}`
    )
    expect(parsedKey2Ledger.walletType).toEqual(WalletType.LEDGER)
    expect(parsedKey2Ledger.walletIdentifier?.toBase58()).toEqual(walletId)
    expect(parsedKey2Ledger.parsedDerivedPath.solanaBip).toEqual(
      BASE_SOLANA_BIP_URL + '/0/1/3'
    )

    walletId = 'FdtiepBtP98oU2uPNgAzUoGwggUDdRXwJH2KJo3oUaix'
    key = '44/501/0/3'
    const parsedKeyWithBipLedger = parseWalletUrl(
      `usb://ledger/${walletId}?key=${key}`
    )
    expect(parsedKeyWithBipLedger.walletType).toEqual(WalletType.LEDGER)
    expect(parsedKeyWithBipLedger.walletIdentifier?.toBase58()).toEqual(
      walletId
    )
    expect(parsedKeyWithBipLedger.parsedDerivedPath.solanaBip).toEqual(
      BASE_SOLANA_BIP_URL + '/0/3'
    )

    // -- without IDENTIFIER
    key = '0/0'
    const parsedKey3Ledger = parseWalletUrl(`usb://ledger?key=${key}`)
    expect(parsedKey3Ledger.walletType).toEqual(WalletType.LEDGER)
    expect(parsedKey3Ledger.walletIdentifier).toBeUndefined()
    expect(parsedKey3Ledger.parsedDerivedPath.solanaBip).toEqual(
      BASE_SOLANA_BIP_URL + '/0/0'
    )

    // -- empty KEY
    key = ''
    const parsedNoKeyTrezor = parseWalletUrl(`usb://trezor?key=${key}`)
    expect(parsedNoKeyTrezor.walletType).toEqual(WalletType.TREZOR)
    expect(parsedNoKeyTrezor.walletIdentifier).toBeUndefined()
    expect(parsedNoKeyTrezor.parsedDerivedPath.solanaBip).toEqual(
      BASE_SOLANA_BIP_URL
    )
  })
})
