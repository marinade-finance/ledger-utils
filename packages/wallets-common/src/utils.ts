import { PublicKey } from '@solana/web3.js'

export enum WalletType {
  TREZOR = 'trezor',
  LEDGER = 'ledger',
}
const SUPPORTED_WALLETS = Object.values(WalletType).join(', ')
const REGEXP_WALLETS = Object.values(WalletType).join('|')

export const WALLET_URL_IDENTIFIER = 'usb://'
export const WALLET_URL_PREFIX_REGEXP = new RegExp(
  `^${WALLET_URL_IDENTIFIER}(${REGEXP_WALLETS})/?`
)

// TODO: is it needed to add prefix 'm/' or direct 44'/501' does work fine for both wallets?
export const SOLANA_BIP44_BASE_PATH = "44'/501'"
export const SOLANA_BIP44_BASE_REGEXP = /^44[']{0,1}\/501[']{0,1}\//

const START_SLASH_REGEXP = new RegExp('^[/ ]*')
const END_SLASH_REGEXP = new RegExp('[/ ]*$')
const IS_NUMERIC_REGEXP = new RegExp('[0-9]+')

/**
 * Generating all combinations for derivation path.
 * When maxDepth is 2 and maxLength is 2, the result is:
 * [[], [0], [1], [2], [0,0], [0,1], [0,2], [1,0], [1,1], [1,2], [2,0], [2,1], [2,2]]
 */
export function generateAllCombinations(
  maxDepth: number | undefined,
  maxLength: number | undefined
): number[][] {
  if (maxDepth === undefined || maxLength === undefined) {
    return []
  }

  const combinations: number[][] = [[]]
  function generate(prefix: number[], remainingLength: number): void {
    if (remainingLength === 0) {
      combinations.push(prefix)
      return
    }
    for (let i = 0; i <= maxDepth!; i++) {
      generate([...prefix, i], remainingLength - 1)
    }
  }
  for (let length = 1; length <= maxLength; length++) {
    generate([], length)
  }
  return combinations
}

/**
 *
 * Parsing the derived path string to check account discovery depth and wide.
 *
 * The method may be provided with default path depth and wide that is expected
 * to be searched by default.
 * The purpose of the method is to enlarge the scope of the account discovery span
 * when the user asks to get address for a derivation path with big numbers.
 *
 * Method expects the path starts with '<m>/purpose/coin_type/...,
 * this expected part is stripped and rest is evaluated.
 *
 * When the derived path is e.g., 44'/501'/0/0/5 then
 * the wide will be 3, depth will be max of the provided numbers as it's 5,
 * but as the default depth is 20 that is bigger to 5 then the returned depth is 20.
 *
 * The default dept and wide is defined from account discovery from BIP-44
 * as it defines depth discovery to gap of 20.
 * The wide comes from fact Solana uses only first 2 "path slots" to generate an address.
 */
export function obtainAccountDiscoveryDepthAndWide(
  derivedPath: string,
  defaultDepth = 20,
  defaultWide = 2
): { depth: number; wide: number } {
  let depth = defaultDepth
  let wide = defaultWide

  let splitDerivedPath = derivedPath.split('/')
  // we expect derived path starts with m/purpose/coin_type, like: 44'/501'
  // stripping that part
  if (splitDerivedPath.length > 1 && splitDerivedPath[0].trim() === 'm') {
    splitDerivedPath = splitDerivedPath.slice(1)
  }
  if (splitDerivedPath.length > 2) {
    splitDerivedPath = splitDerivedPath.slice(2)
    wide = Math.max(defaultWide, splitDerivedPath.length)
    depth = Math.max(defaultDepth, ...splitDerivedPath.map(v => parseFloat(v)))
  }
  return { depth, wide }
}

/**
 * Parsing string as ledger url that could be in format of url or derivation path.
 * Some of the examples (trying to be compatible with solana cli https://github.com/solana-labs/solana/blob/v1.14.19/clap-utils/src/keypair.rs#L613)
 * Derivation path consists of the "44'" part that signifies the BIP44 standard, and the "501'" part that signifies the Solana's BIP44 coin type.
 *
 * - `usb://ledger|trezor` - taking first device and using solana default derivation path 44/501. This is wallet identifier that Ledger uses to identify particular device.
 * - `usb://ledger|trezor?key=0/1` - taking first device and using solana derivation path 44/501/0/1
 * - `usb://ledger|trezor/9rPVSygg3brqghvdZ6wsL2i5YNQTGhXGdJzF65YxaCQd` - searching of all ledger devices where solana default derivation path 44/501/0/0 will result in pubkey 9rPVSygg3brqghvdZ6wsL2i5YNQTGhXGdJzF65YxaCQd
 * - `usb://ledger/9rPVSygg3brqghvdZ6wsL2i5YNQTGhXGdJzF65YxaCQd?key=0/1` - searching of all ledger devices where solana derivation path 44/501/0/1 will result in pubkey 9rPVSygg3brqghvdZ6wsL2i5YNQTGhXGdJzF65YxaCQd
 */
export function parseWalletUrl(walletUrl: string): {
  walletType: WalletType
  walletIdentifier: PublicKey | undefined
  parsedDerivedPath: string
} {
  walletUrl = walletUrl.trim()
  const walletUrlMatch = WALLET_URL_PREFIX_REGEXP.exec(walletUrl)

  let walletType
  if (walletUrlMatch) {
    walletType = walletUrlMatch[1] as WalletType
    switch (walletType) {
      case WalletType.TREZOR:
        break
      case WalletType.LEDGER:
        break
      default:
        throw new Error(
          `Invalid hardware wallet type of provided url "${walletUrl}". ` +
            `Supported wallets are ${SUPPORTED_WALLETS}.`
        )
    }
  } else {
    throw new Error(
      `Invalid hardware wallet url prefix, provided url "${walletUrl}". ` +
        `Expected url started with "${WALLET_URL_IDENTIFIER}". ` +
        `Supported wallets are ${SUPPORTED_WALLETS}.`
    )
  }

  // removal of the prefix + an optional slash
  const walletPath = walletUrl.replace(WALLET_URL_PREFIX_REGEXP, '')

  const extractIdentifierAndKey = function (queryString: string): {
    identifier?: string
    key?: string
  } {
    const regex = /^([^?]*)\??(?:key=([^]*)|)$/
    const match = queryString.trim().match(regex)

    let identifier: string | undefined = undefined
    let key: string | undefined = undefined
    if (match) {
      identifier = match[1]
      key = match[2]
    }
    if (
      !match ||
      (queryString.length > 0 && key === undefined && identifier === undefined)
    ) {
      throw new Error(
        `Invalid wallet url: "${walletUrl}"` +
          '. Expected url format "usb://<wallet-type><pubkey>?key=<number>". ' +
          `Supported wallets are ${SUPPORTED_WALLETS}.`
      )
    }
    return { identifier, key }
  }

  // NOTE: expecting the wallet identifier is type of Pubkey
  const evaluateWalletIdentifier = function (
    pubkey: string | undefined
  ): PublicKey | undefined {
    const pubkeyAdjusted = pubkey?.replace(END_SLASH_REGEXP, '')
    if (pubkeyAdjusted === undefined || pubkeyAdjusted.length === 0) {
      return undefined
    } else {
      try {
        return new PublicKey(pubkeyAdjusted)
      } catch (e) {
        throw new Error(
          'Failed to parse wallet identifier from wallet url: ' +
            `"${walletUrl}". Expecting the "${pubkey}" being pubkey, error: ${e}`
        )
      }
    }
  }

  const testDerivedKeyNumbers = function (derivedPath: string) {
    const splittedPath = derivedPath.trim().split('/')
    let finalPath = ''
    console.log('>>> splitted path', splittedPath)
    if (splittedPath.length === 0) {
      throw new Error(
        'Failed to parse wallet derived path from wallet url: ' +
          `"${walletUrl}". Expecting the "${derivedPath}" being a derived path.`
      )
    }
    for (let pathItem of splittedPath) {
      pathItem = pathItem.trim()
      finalPath += `/${pathItem}`
      if (!IS_NUMERIC_REGEXP.test(pathItem)) {
        throw new Error(
          'Failed to parse wallet derived path from wallet url: ' +
            `"${walletUrl}". Expecting the "${derivedPath}" being a set of numbers delimited with /.`
        )
      }
    }
    return finalPath
  }

  // checking existence of ?key= part
  let parsedDerivedPath: string
  const { identifier, key } = extractIdentifierAndKey(walletPath)
  const walletIdentifier = evaluateWalletIdentifier(identifier)
  if (key === undefined) {
    //case: usb://ledger/<pubkey>
    parsedDerivedPath = SOLANA_BIP44_BASE_PATH
  } else {
    //case: usb://ledger/<pubkey>?key=<number>
    if (key === '') {
      // case: usb://ledger/<pubkey>?key=
      parsedDerivedPath = SOLANA_BIP44_BASE_PATH
    } else if (SOLANA_BIP44_BASE_REGEXP.test(key)) {
      // case: usb://ledger/<pubkey>?key=44'/501'/<number>
      const onlyKey = key.replace(SOLANA_BIP44_BASE_REGEXP, '')
      parsedDerivedPath =
        SOLANA_BIP44_BASE_PATH + testDerivedKeyNumbers(onlyKey)
    } else {
      // case: usb://ledger/<pubkey>?key=<number>
      const onlyKey = key.replace(START_SLASH_REGEXP, '')
      parsedDerivedPath =
        SOLANA_BIP44_BASE_PATH + testDerivedKeyNumbers(onlyKey)
    }
  }

  return { walletType, walletIdentifier, parsedDerivedPath }
}
