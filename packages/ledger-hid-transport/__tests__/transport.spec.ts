import { version as devicesVersion } from '@ledgerhq/devices/package.json'

import { getDevices } from '../src'
import { fakeNodeHid, ledgerDevice } from '../test-utils/fake-hid'

import type * as FakeHidModule from '../test-utils/fake-hid'

jest.mock(
  'node-hid',
  () =>
    jest.requireActual<typeof FakeHidModule>('../test-utils/fake-hid')
      .fakeNodeHid,
)

const platform = process.platform

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value })
}

let devicesAsync: jest.SpiedFunction<typeof fakeNodeHid.devicesAsync>

beforeEach(() => {
  fakeNodeHid.devices = []
  devicesAsync = jest.spyOn(fakeNodeHid, 'devicesAsync')
})

afterEach(() => {
  setPlatform(platform)
  jest.restoreAllMocks()
})

describe('getDevices', () => {
  it('lists Ledger devices by vendor id', async () => {
    fakeNodeHid.devices = [ledgerDevice()]
    expect(await getDevices()).toEqual([
      { path: '/dev/hidraw0', productId: 0x5011, model: 'nanoSP' },
    ])
    expect(devicesAsync).toHaveBeenCalledWith(0x2c97, 0)
  })

  it.each(['darwin', 'win32'] as const)(
    'keeps only the APDU usage page on %s',
    async value => {
      setPlatform(value)
      fakeNodeHid.devices = [
        ledgerDevice({ path: 'apdu', usagePage: 0xffa0, interface: 0 }),
        ledgerDevice({ path: 'fido', usagePage: 0xf1d0, interface: 0 }),
      ]
      expect((await getDevices()).map(d => d.path)).toEqual(['apdu'])
    },
  )

  it('keeps interface 0 or the APDU usage page on linux', async () => {
    setPlatform('linux')
    fakeNodeHid.devices = [
      ledgerDevice({ path: 'iface0', usagePage: undefined, interface: 0 }),
      ledgerDevice({ path: 'uhid', usagePage: 0xffa0, interface: -1 }),
      ledgerDevice({ path: 'fido', usagePage: 0xf1d0, interface: 1 }),
    ]
    expect((await getDevices()).map(d => d.path)).toEqual(['iface0', 'uhid'])
  })

  it('drops entries without path and lists each path once', async () => {
    fakeNodeHid.devices = [
      ledgerDevice({ path: undefined }),
      ledgerDevice({ path: 'a' }),
      ledgerDevice({ path: 'a' }),
      ledgerDevice({ path: 'b' }),
    ]
    expect((await getDevices()).map(d => d.path)).toEqual(['a', 'b'])
  })

  it('ignores devices of other vendors', async () => {
    fakeNodeHid.devices = [ledgerDevice({ vendorId: 0x1209 })]
    expect(await getDevices()).toEqual([])
  })

  it('keeps an unknown model and reports it to the logger', async () => {
    fakeNodeHid.devices = [ledgerDevice({ productId: 0x9911 })]
    const logger = jest.fn()
    expect(await getDevices({ logger })).toEqual([
      { path: '/dev/hidraw0', productId: 0x9911, model: undefined },
    ])
    expect(logger).toHaveBeenCalledWith(
      'Ledger device /dev/hidraw0 productId 0x9911 is not a model known to ' +
        `@ledgerhq/devices ${devicesVersion}`,
    )
  })

  it('rejects with the enumeration error', async () => {
    const error = new Error('hid enumeration failed')
    devicesAsync.mockRejectedValueOnce(error)
    await expect(getDevices()).rejects.toBe(error)
  })
})
