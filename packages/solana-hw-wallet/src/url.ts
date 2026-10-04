import { PublicKey } from '@solana/web3.js'

export enum WalletType {
  LEDGER = 'ledger',
  TREZOR = 'trezor',
}

export const WALLET_URL_SCHEME = 'usb://'
export const SOLANA_BIP44_BASE_PATH = "44'/501'"

const SUPPORTED_WALLETS = Object.values(WalletType).join(', ')
const WALLET_URL_REGEXP = new RegExp(
  `^${WALLET_URL_SCHEME}(${Object.values(WalletType).join('|')})(?:/([^?]*))?(?:\\?(.*))?$`,
  'i',
)
const SOLANA_BIP44_PREFIX_REGEXP = /^(m\/)?44['h]?\/501['h]?(\/|$)/
const HARDENED_OFFSET = 0x80000000

export type ParsedWalletUrl = {
  walletType: WalletType
  /** Agave semantics: pubkey at 44'/501' selecting the device; the pubkey at the derived path is accepted too */
  walletId: PublicKey | undefined
  /** Indexes after 44'/501', every index is hardened (SLIP-10 ed25519) */
  derivationPath: number[]
  /** true when `?key=` is provided with a value, an explicit path is never replaced by account search */
  explicitKey: boolean
}

export function isHardwareWalletUrl(url: string): boolean {
  return url.trim().toLowerCase().startsWith(WALLET_URL_SCHEME)
}

// Solana CLI (Agave) keypair url format, examples in README
export function parseWalletUrl(walletUrl: string): ParsedWalletUrl {
  const url = walletUrl.trim()
  const match = WALLET_URL_REGEXP.exec(url)
  if (!match) {
    throw new Error(
      `Invalid hardware wallet url "${url}". ` +
        `Expected format "${WALLET_URL_SCHEME}<wallet-type>[/<pubkey>][?key=<derivation-path>]". ` +
        `Supported wallets are ${SUPPORTED_WALLETS}.`,
    )
  }
  const [, type = '', pathPart, query] = match
  const walletType = type.toLowerCase() as WalletType
  const walletId = parseWalletId(url, pathPart)
  const key = parseQueryKey(url, query)
  const derivationPath = key === undefined ? [] : parseDerivationPath(url, key)
  return {
    walletType,
    walletId,
    derivationPath,
    explicitKey: key !== undefined && key.trim() !== '',
  }
}

export function formatDerivationPath(derivationPath: number[]): string {
  return [SOLANA_BIP44_BASE_PATH, ...derivationPath.map(i => `${i}'`)].join('/')
}

export function toHardenedPath(derivationPath: number[]): number[] {
  return [44, 501, ...derivationPath].map(i => (i | HARDENED_OFFSET) >>> 0)
}

function parseWalletId(
  url: string,
  pathPart: string | undefined,
): PublicKey | undefined {
  const [segment, ...rest] = (pathPart ?? '')
    .split('/')
    .filter(s => s.trim() !== '')
  if (segment === undefined) {
    return undefined
  }
  if (rest.length > 0) {
    throw new Error(
      `Invalid hardware wallet url "${url}". Expected a single pubkey after the wallet type.`,
    )
  }
  try {
    return new PublicKey(segment.trim())
  } catch (e) {
    throw new Error(
      `Failed to parse wallet id from hardware wallet url "${url}". ` +
        `Expecting the "${segment}" being pubkey, error: ${String(e)}`,
    )
  }
}

function parseQueryKey(
  url: string,
  query: string | undefined,
): string | undefined {
  if (query === undefined || query === '') {
    return undefined
  }
  let key: string | undefined
  for (const param of query.split('&')) {
    const [name, ...value] = param.split('=')
    if (name !== 'key' || value.length === 0 || key !== undefined) {
      throw new Error(
        `Invalid hardware wallet url "${url}". ` +
          `Only a single query parameter "key" is supported, got "${param}".`,
      )
    }
    key = value.join('=')
  }
  return key
}

function parseDerivationPath(url: string, key: string): number[] {
  const path = key
    .trim()
    .replace(/^\/+/, '')
    .replace(SOLANA_BIP44_PREFIX_REGEXP, '')
    .replace(/\/+$/, '')
  if (path === '') {
    return []
  }
  return path.split('/').map(item => {
    const index = item.trim().replace(/['h]$/, '')
    if (!/^[0-9]+$/.test(index) || Number(index) >= HARDENED_OFFSET) {
      throw new Error(
        `Failed to parse derivation path from hardware wallet url "${url}". ` +
          `Expecting the "${key}" being a set of numbers delimited with /.`,
      )
    }
    return Number(index)
  })
}

// (2, 2) => [[], [0], [1], [2], [0,0], [0,1], [0,2], [1,0], ..., [2,2]]
export function generateAllCombinations(
  maxDepth: number,
  maxLength: number,
): number[][] {
  const combinations: number[][] = [[]]
  function generate(prefix: number[], remainingLength: number): void {
    if (remainingLength === 0) {
      combinations.push(prefix)
      return
    }
    for (let i = 0; i <= maxDepth; i++) {
      generate([...prefix, i], remainingLength - 1)
    }
  }
  for (let length = 1; length <= maxLength; length++) {
    generate([], length)
  }
  return combinations
}

// depth 20 is the BIP-44 gap limit, wide 2 is Solana CLI account/change
export function getHeuristicDepthAndWide(
  derivationPath: number[],
  defaultDepth = 20,
  defaultWide = 2,
): { depth: number; wide: number } {
  return {
    depth: Math.max(defaultDepth, ...derivationPath),
    wide: Math.max(defaultWide, derivationPath.length),
  }
}
