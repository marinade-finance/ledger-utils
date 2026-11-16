import { chmod, mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { version as devicesVersion } from '@ledgerhq/devices/package.json'
import {
  CantOpenDevice,
  DisconnectedDevice,
  DisconnectedDeviceDuringOperation,
  TransportExchangeTimeoutError,
  TransportRaceCondition,
} from '@ledgerhq/hw-transport/errors'

import TransportNodeHid, { getDevices } from '../src'
import {
  FakeHidDevice,
  fakeNodeHid,
  ledgerDevice,
} from '../test-utils/fake-hid'

import type * as FakeHidModule from '../test-utils/fake-hid'

jest.mock(
  'node-hid',
  () =>
    jest.requireActual<typeof FakeHidModule>('../test-utils/fake-hid')
      .fakeNodeHid,
)

const DISCONNECTED = 'Ledger device connection is closed, open the device again'
const DISCONNECTED_DURING_OPERATION =
  'Ledger device was disconnected during the operation, reconnect it and open it again'
const OK = Buffer.from('9000', 'hex')

const platform = process.platform

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value })
}

function echo(apdu: Buffer): Buffer {
  return Buffer.concat([apdu, OK])
}

let devicesAsync: jest.SpiedFunction<typeof fakeNodeHid.devicesAsync>

beforeEach(() => {
  fakeNodeHid.devices = []
  fakeNodeHid.device = new FakeHidDevice(echo)
  fakeNodeHid.openError = undefined
  fakeNodeHid.opened = []
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

describe('TransportNodeHid', () => {
  async function unreadableFile(): Promise<string> {
    const path = join(await mkdtemp(join(tmpdir(), 'ledger-hid-')), 'hidraw')
    await writeFile(path, '')
    await chmod(path, 0)
    return path
  }

  async function rejection(promise: Promise<unknown>): Promise<Error> {
    return promise.then(
      () => {
        throw new Error('expected a rejection')
      },
      (e: unknown) => e as Error,
    )
  }

  function channelOf(device: FakeHidDevice): number {
    return device.writes.at(-1)!.readUInt16BE(1)
  }

  function frame(channel: number, sequence: number, data: string): Buffer {
    const result = Buffer.alloc(64)
    result.writeUInt16BE(channel, 0)
    result[2] = 0x05
    result.writeUInt16BE(sequence, 3)
    Buffer.from(data, 'hex').copy(result, 5)
    return result
  }

  it('opens the device not exclusively', async () => {
    await TransportNodeHid.open('/dev/hidraw0')
    expect(fakeNodeHid.opened).toEqual([
      { path: '/dev/hidraw0', options: { nonExclusive: true } },
    ])
  })

  it('reports a device that cannot be opened', async () => {
    const path = '/nonexistent/hidraw0'
    fakeNodeHid.openError = new Error(`cannot open device with path ${path}`)
    const error = await rejection(TransportNodeHid.open(path))
    expect(error).toBeInstanceOf(CantOpenDevice)
    expect(error.name).toBe('CantOpenDevice')
    expect(error.message).toBe(
      `Cannot open Ledger device ${path}: cannot open device with path ${path}`,
    )
    expect(error.cause).toBe(fakeNodeHid.openError)
  })

  it('points to the udev rules when the Linux device is not accessible', async () => {
    setPlatform('linux')
    const path = await unreadableFile()
    fakeNodeHid.openError = new Error(`cannot open device with path ${path}`)
    const error = await rejection(TransportNodeHid.open(path))
    expect(error.message).toBe(
      `Cannot open Ledger device ${path}: permission denied. ` +
        'Install the Ledger udev rules: https://github.com/LedgerHQ/udev-rules',
    )
    expect(error.cause).toBe(fakeNodeHid.openError)
  })

  it('does not check file access on macOS', async () => {
    setPlatform('darwin')
    const path = await unreadableFile()
    fakeNodeHid.openError = new Error('open failed')
    expect((await rejection(TransportNodeHid.open(path))).message).toBe(
      `Cannot open Ledger device ${path}: open failed`,
    )
  })

  it('exchanges a single frame APDU with report id prefixed writes', async () => {
    const transport = await TransportNodeHid.open('/dev/hidraw0')
    const apdu = Buffer.from('e001000000', 'hex')
    expect(await transport.exchange(apdu)).toEqual(echo(apdu))
    expect(fakeNodeHid.device.writes).toHaveLength(1)
    expect(fakeNodeHid.device.writes[0]).toHaveLength(65)
    expect(fakeNodeHid.device.writes[0]![0]).toBe(0x00)
  })

  it('exchanges a multi frame APDU and response', async () => {
    fakeNodeHid.device.respond = () => Buffer.alloc(300, 0xab)
    const transport = await TransportNodeHid.open('/dev/hidraw0')
    expect(await transport.exchange(Buffer.alloc(260, 0x01))).toEqual(
      Buffer.alloc(300, 0xab),
    )
    expect(fakeNodeHid.device.writes).toHaveLength(5)
    for (const write of fakeNodeHid.device.writes) {
      expect(write).toHaveLength(65)
      expect(write[0]).toBe(0x00)
    }
  })

  it('exchanges APDUs back to back', async () => {
    const transport = await TransportNodeHid.open('/dev/hidraw0')
    const first = Buffer.from('e0010000', 'hex')
    const second = Buffer.from('e0020000', 'hex')
    expect(await transport.exchange(first)).toEqual(echo(first))
    expect(await transport.exchange(second)).toEqual(echo(second))
  })

  it('refuses a concurrent exchange', async () => {
    const transport = await TransportNodeHid.open('/dev/hidraw0')
    const apdu = Buffer.from('e0010000', 'hex')
    const first = transport.exchange(apdu)
    const error = await rejection(transport.exchange(apdu))
    expect(error).toBeInstanceOf(TransportRaceCondition)
    expect(error.message).toBe(
      'An action was already pending on the Ledger device. Please deny or reconnect.',
    )
    expect(await first).toEqual(echo(apdu))
  })

  it.each([
    ['write', (device: FakeHidDevice) => (device.failWrite = new Error('w'))],
    ['read', (device: FakeHidDevice) => (device.failRead = new Error('r'))],
  ])('closes on %s failure and emits disconnect once', async (_, fail) => {
    const transport = await TransportNodeHid.open('/dev/hidraw0')
    const disconnect = jest.fn()
    transport.on('disconnect', disconnect)
    const cause = fail(fakeNodeHid.device)

    const error = await rejection(
      transport.exchange(Buffer.from('e001', 'hex')),
    )

    expect(error).toBeInstanceOf(DisconnectedDeviceDuringOperation)
    expect(error.name).toBe('DisconnectedDeviceDuringOperation')
    expect(error.message).toBe(DISCONNECTED_DURING_OPERATION)
    expect(error.cause).toBe(cause)
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(fakeNodeHid.device.closeCount).toBe(1)

    const next = await rejection(transport.exchange(Buffer.from('e001', 'hex')))
    expect(next).toBeInstanceOf(DisconnectedDevice)
    expect(next.message).toBe(DISCONNECTED)
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it.each([
    [
      'another channel',
      'Invalid channel',
      (c: number) => frame((c + 1) % 0xffff, 0, '00029000'),
    ],
    [
      'a frame out of order',
      'Invalid sequence',
      (c: number) => frame(c, 1, '9000'),
    ],
  ])('closes on a response frame of %s', async (_, message, wrongFrame) => {
    const device = fakeNodeHid.device
    device.respond = () => {
      device.queueFrames(wrongFrame(channelOf(device)))
      return undefined
    }
    const transport = await TransportNodeHid.open('/dev/hidraw0')
    const disconnect = jest.fn()
    transport.on('disconnect', disconnect)

    const error = await rejection(
      transport.exchange(Buffer.from('e001', 'hex')),
    )

    expect(error.message).toBe(message)
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(device.closeCount).toBe(1)
    expect(
      (await rejection(transport.exchange(Buffer.from('e001', 'hex')))).message,
    ).toBe(DISCONNECTED)
  })

  it('drops a stale frame before the exchange', async () => {
    const transport = await TransportNodeHid.open('/dev/hidraw0')
    fakeNodeHid.device.queueFrames(frame(0x4242, 0, '00025515'))
    const apdu = Buffer.from('e0010000', 'hex')
    expect(await transport.exchange(apdu)).toEqual(echo(apdu))
  })

  it('refuses an empty APDU and stays open', async () => {
    const transport = await TransportNodeHid.open('/dev/hidraw0')
    await expect(transport.exchange(Buffer.alloc(0))).rejects.toThrow(
      'APDU is empty',
    )
    const apdu = Buffer.from('e0010000', 'hex')
    expect(await transport.exchange(apdu)).toEqual(echo(apdu))
  })

  it('closes after the running exchange, once', async () => {
    const device = fakeNodeHid.device
    device.responseDelayMs = 50
    const transport = await TransportNodeHid.open('/dev/hidraw0')
    const apdu = Buffer.from('e0010000', 'hex')
    const exchange = transport.exchange(apdu)
    const closing = transport.close()
    expect(await exchange).toEqual(echo(apdu))
    await closing
    await transport.close()
    expect(device.closeCount).toBe(1)
  })

  it('refuses an exchange after close', async () => {
    const transport = await TransportNodeHid.open('/dev/hidraw0')
    await transport.close()
    const error = await rejection(
      transport.exchange(Buffer.from('e001', 'hex')),
    )
    expect(error).toBeInstanceOf(DisconnectedDevice)
    expect(error.name).toBe('DisconnectedDevice')
    expect(error.message).toBe(DISCONNECTED)
    expect(fakeNodeHid.device.writes).toHaveLength(0)
  })

  it('refuses an exchange started while close is pending', async () => {
    const transport = await TransportNodeHid.open('/dev/hidraw0')
    const closing = transport.close()
    const error = await rejection(
      transport.exchange(Buffer.from('e001', 'hex')),
    )
    await closing
    expect(error).toBeInstanceOf(DisconnectedDevice)
    expect(error.message).toBe(DISCONNECTED)
    expect(fakeNodeHid.device.writes).toHaveLength(0)
    expect(fakeNodeHid.device.closeCount).toBe(1)
  })

  it('traces APDUs to the logger', async () => {
    const logger = jest.fn()
    const transport = await TransportNodeHid.open('/dev/hidraw0', { logger })
    await transport.exchange(Buffer.from('e001', 'hex'))
    expect(logger.mock.calls).toEqual([['=> e001'], ['<= e0019000']])
  })

  describe('with abortTimeoutMs', () => {
    const TIMEOUT =
      'Ledger device did not respond within 50 ms, the connection was closed'

    it('closes and emits disconnect once when the device does not respond', async () => {
      const device = fakeNodeHid.device
      device.respond = () => undefined
      const transport = await TransportNodeHid.open('/dev/hidraw0')
      const disconnect = jest.fn()
      transport.on('disconnect', disconnect)

      const error = await rejection(
        transport.exchange(Buffer.from('e001', 'hex'), { abortTimeoutMs: 50 }),
      )

      expect(error).toBeInstanceOf(TransportExchangeTimeoutError)
      expect(error.name).toBe('TransportExchangeTimeoutError')
      expect(error.message).toBe(TIMEOUT)
      expect(device.closeCount).toBe(1)
      expect(disconnect).toHaveBeenCalledTimes(1)
    })

    it('never returns a late response to the next exchange', async () => {
      const device = fakeNodeHid.device
      device.respond = () => undefined
      const transport = await TransportNodeHid.open('/dev/hidraw0')
      const disconnect = jest.fn()
      transport.on('disconnect', disconnect)
      await rejection(
        transport.exchange(Buffer.from('e001', 'hex'), { abortTimeoutMs: 50 }),
      )
      device.queueFrames(Buffer.alloc(64))
      const writes = device.writes.length

      const next = await rejection(
        transport.exchange(Buffer.from('e002', 'hex')),
      )

      expect(next).toBeInstanceOf(DisconnectedDevice)
      expect(next.message).toBe(DISCONNECTED)
      expect(device.writes).toHaveLength(writes)
      expect(disconnect).toHaveBeenCalledTimes(1)
      await transport.close()
      expect(device.closeCount).toBe(1)
    })

    it('reports the timeout when closing the device fails', async () => {
      const device = fakeNodeHid.device
      device.respond = () => undefined
      device.failClose = new Error('close failed')
      const transport = await TransportNodeHid.open('/dev/hidraw0')
      const error = await rejection(
        transport.exchange(Buffer.from('e001', 'hex'), { abortTimeoutMs: 50 }),
      )
      expect(error.message).toBe(TIMEOUT)
    })

    it('waits longer than one read slice without abortTimeoutMs', async () => {
      fakeNodeHid.device.responseDelayMs = 1500
      const transport = await TransportNodeHid.open('/dev/hidraw0')
      const apdu = Buffer.from('e0010000', 'hex')
      expect(await transport.exchange(apdu)).toEqual(echo(apdu))
    })
  })
})
