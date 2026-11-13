# Solana hardware wallet utilities

<a href="https://www.npmjs.com/package/@marinade.finance/solana-hw-wallet"><img src="https://img.shields.io/npm/v/%40marinade.finance%2Fsolana-hw-wallet?logo=npm&color=377CC0" /></a>

TypeScript Ledger and Trezor signing for Solana Node.js CLI applications.

- [solana-hw-wallet](packages/solana-hw-wallet/README.md) - the library

## Development

```sh
pnpm install
pnpm build
pnpm test
```

To publish, update versions in `packages/*/package.json` and run `pnpm publish:all`.
`@marinade.finance/ledger-utils` (3.x) was replaced by this library, once 1.0.0 is out mark it deprecated:

```sh
npm deprecate @marinade.finance/ledger-utils "moved to @marinade.finance/solana-hw-wallet, use parseHardwareWallet"
```
