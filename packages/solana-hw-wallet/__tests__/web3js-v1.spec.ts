import { describeWeb3Wallet } from '../test-utils/web3js-suite'

import type * as FakeLedgerModule from '../test-utils/fake-ledger'

jest.mock(
  '@ledgerhq/hw-transport-node-hid-noevents',
  () =>
    jest.requireActual<typeof FakeLedgerModule>('../test-utils/fake-ledger')
      .fakeLedgerHidModule,
)

describeWeb3Wallet({
  label: 'web3.js 1.99',
  v1Error: 'Serialization of version 1 transaction messages is not supported',
})
