# Solana hardware wallet utilities

TypeScript Ledger and Trezor signing for Solana Node.js CLI applications.

| Package | npm | |
| --- | --- | --- |
| [solana-hw-wallet](packages/solana-hw-wallet/README.md) | <a href="https://www.npmjs.com/package/@marinade.finance/solana-hw-wallet"><img src="https://img.shields.io/npm/v/%40marinade.finance%2Fsolana-hw-wallet?logo=npm&color=377CC0" /></a> | the library |
| [ledger-hid-transport](packages/ledger-hid-transport/README.md) | <a href="https://www.npmjs.com/package/@marinade.finance/ledger-hid-transport"><img src="https://img.shields.io/npm/v/%40marinade.finance%2Fledger-hid-transport?logo=npm&color=377CC0" /></a> | the Ledger USB HID transport it uses |
| ledger-utils | <a href="https://www.npmjs.com/package/@marinade.finance/ledger-utils"><img src="https://img.shields.io/npm/v/%40marinade.finance%2Fledger-utils?logo=npm&color=lightgrey" /></a> | deprecated 3.x, replaced by solana-hw-wallet (`parseLedgerWallet` is now `parseHardwareWallet`) |

## Development

```sh
pnpm install
pnpm build
pnpm test
```

## Release

Update versions in `packages/*/package.json` and run `pnpm publish:all`.
It publishes ledger-hid-transport before solana-hw-wallet, which depends on it.
Then it tags `v<solana-hw-wallet version>` locally. Push the tag to create the GitHub Release:

```sh
git push origin v1.0.0
```
