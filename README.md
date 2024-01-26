# Solana Ledger utilities

TypeScript ledger utilities for Solana, mainly targeted to be used in CLI nodejs applications.

For more see [ledger-utils/README](packages/ledger-utils/README.md).

## Development

After cloning the repository

```sh
pnpm install

# building the library under build/ directory
pnpm build

# running tests
# there is no tests for real usage of Ledger HW wallet
# using some mock is more about a TODO (feel free to contribute)
pnpm test
```

To publish a new version

* update version in [ledger-utils/package.json](./packages/ledger-utils/package.json)
* run `pnpm publish:ledger`