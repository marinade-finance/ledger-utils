# Solana hardware wallet utilities

<a href="https://www.npmjs.com/package/@marinade.finance/solana-hw-wallet"><img src="https://img.shields.io/npm/v/%40marinade.finance%2Fsolana-hw-wallet?logo=npm&color=377CC0" /></a>

TypeScript Ledger and Trezor signing for Solana Node.js CLI applications.

- [solana-hw-wallet](packages/solana-hw-wallet/README.md) - the library
- [ledger-utils](packages/ledger-utils/README.md) - deprecated alias of the library

## Development

```sh
pnpm install
pnpm build
pnpm test
```

To publish, update versions in `packages/*/package.json` and run `pnpm publish:all`.
After publishing, mark the old package deprecated:

```sh
npm deprecate @marinade.finance/ledger-utils "use @marinade.finance/solana-hw-wallet"
```
