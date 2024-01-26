# Solana @marinade.finance/ledger-utils

[`@marinade.finance/ledger-utils`](https://www.npmjs.com/package/@marinade.finance/ledger-utils)

These utilities are designed for use with the ledger in CLI environments.

They attempt to parse strings as input URLs for derivation paths.
The parsing aims to maintain compatibility with the Solana CLI,
as documented [in Rust solana-labs/solana source code](https://github.com/solana-labs/solana/blob/v1.14.19/clap-utils/src/keypair.rs#L613).

To verify if the parsing matches, run the command `solana-keygen`.
If you encounter any discrepancies, please reach out to us on [Discord](https://discord.com/invite/6EtUf4Euu6)
or create an [issue](https://github.com/marinade-finance/ledger-utils/issues) here on GitHub.

```
solana-keygen pubkey usb://ledger
```

## Usage of @marinade.finance/ledger-utils in Typescript code

The best is to take a look at the usage of CLI in project [`validator-bonds`](https://github.com/marinade-finance/validator-bonds/blob/v1.1.5/packages/validator-bonds-cli/src/index.ts#L32).
The `ledger-utils` is used when `usb://ledger` parameter is passed within CLI parameter.
The [`parseWallet`](https://github.com/marinade-finance/marinade-ts-cli/blob/libs_2.1.3/packages/lib/cli-common/src/parsers.ts#L79)
(an utility function within an utility library https://github.com/marinade-finance/marinade-ts-cli/tree/libs_2.1.3/packages/lib/cli-common)
kicks in the ledger parsing. When the provided format matches the Solana ledger path (see the BIP44 Parsing info below)
then an instance of [`Wallet`](./src/ledger.ts) interface is created and could be used for transaction signing.

## Solana BIP44 Address Parsing

Solana base derivation path is `"44/"501`
The `"44'"` part that signifies the BIP44 standard, and the "501'" part that signifies Solana's BIP44 coin type.

Parsing works in the following way:

- `usb://ledger` - taking the first device and using Solana's default derivation path `44/501`
- `usb://ledger?key=0/1` - taking the first device and using Solana's derivation path `44/501/0/1`
- `usb://ledger/9rPVSygg3brqghvdZ6wsL2i5YNQTGhXGdJzF65YxaCQd?key=0/1` - searching all ledger devices where the Solana derivation path `44/501/0/1` will result in public key `9rPVSygg3brqghvdZ6wsL2i5YNQTGhXGdJzF65YxaCQd`
- `usb://ledger/9rPVSygg3brqghvdZ6wsL2i5YNQTGhXGdJzF65YxaCQd` - searching all ledger devices where Solana's default derivation path `44/501/` will result in public key `9rPVSygg3brqghvdZ6wsL2i5YNQTGhXGdJzF65YxaCQd`

The SDK provides a heuristic search for the address when a public key address is provided
but no derivation path. Then it starts searching through the address space until by default `44/501/10/10/10` is reached.
While the space search could be configured (see [searchDerivedPathFromPubkey at ledger.ts](./src/ledger.ts)).

Not only the SDK but the CLI argument may extend the derivation search depth.
Pass the `key` value of zeros and a last digit number. Such input defines wide and depth of the search.
For example, `usb://ledger/9rPVSygg3brqghvdZ6wsL2i5YNQTGhXGdJzF65YxaCQd?key=0/0/0/3` will search for the pubkey `9rPVSygg3brqghvdZ6wsL2i5YNQTGhXGdJzF65YxaCQd` in ledger-derived keys in wide of 4 and depth of 3
(i.e., until `44/501/3/3/3/3` is reached).
