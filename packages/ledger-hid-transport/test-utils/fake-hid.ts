import { createHIDframing } from './legacy-hid-framing'

import type { ResponseAcc } from './legacy-hid-framing'
import type { Device } from 'node-hid'

export type Responder = (apdu: Buffer) => Buffer | undefined

export function ledgerDevice(overrides: Partial<Device> = {}): Device {
  return {
    vendorId: 0x2c97,
    productId: 0x5011,
    path: '/dev/hidraw0',
    release: 0x0201,
    interface: 0,
    usagePage: 0xffa0,
    ...overrides,
  }
}

// HIDAsync of a Ledger: deframes written APDUs with the legacy codec and frames the responder answer
export class FakeHidDevice {
  public readonly writes: Buffer[] = []
  public closeCount = 0
  public failWrite: Error | undefined
  public failRead: Error | undefined
  public failClose: Error | undefined
  public responseDelayMs = 0
  private readonly frames: Buffer[] = []
  private request: ResponseAcc
  private wakeUp: (() => void) | undefined

  constructor(public respond: Responder) {}

  get closed(): boolean {
    return this.closeCount > 0
  }

  queueFrames(...frames: Buffer[]): void {
    this.frames.push(...frames)
    this.wakeUp?.()
  }

  async write(data: Buffer): Promise<number> {
    this.assertOpen()
    if (this.failWrite) {
      throw this.failWrite
    }
    this.writes.push(Buffer.from(data))
    const frame = data.subarray(1)
    const framing = createHIDframing(frame.readUInt16BE(0), 64)
    this.request = framing.reduceResponse(this.request, frame)
    const apdu = framing.getReducedResult(this.request)
    if (apdu) {
      this.request = undefined
      const response = this.respond(apdu)
      if (response) {
        setTimeout(() => {
          this.queueFrames(...framing.makeBlocks(response))
        }, this.responseDelayMs)
      }
    }
    return data.length + 1
  }

  async read(timeoutMs?: number): Promise<Buffer> {
    this.assertOpen()
    if (this.failRead) {
      throw this.failRead
    }
    if (this.frames.length === 0 && timeoutMs !== 0) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, timeoutMs)
        this.wakeUp = () => {
          clearTimeout(timer)
          resolve()
        }
      })
      this.wakeUp = undefined
    }
    return this.frames.shift() ?? Buffer.alloc(0)
  }

  async close(): Promise<void> {
    this.assertOpen()
    this.closeCount++
    if (this.failClose) {
      throw this.failClose
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('device has been closed')
    }
  }
}

// jest.mock('node-hid') factory, devices are what the operating system lists
export const fakeNodeHid = {
  devices: [] as Device[],
  device: new FakeHidDevice(() => undefined),
  openError: undefined as Error | undefined,
  opened: [] as { path: string; options: unknown }[],
  devicesAsync: (vid: number): Promise<Device[]> =>
    Promise.resolve(fakeNodeHid.devices.filter(d => d.vendorId === vid)),
  HIDAsync: {
    open: (path: string, options: unknown): Promise<FakeHidDevice> => {
      fakeNodeHid.opened.push({ path, options })
      return fakeNodeHid.openError
        ? Promise.reject(fakeNodeHid.openError)
        : Promise.resolve(fakeNodeHid.device)
    },
  },
}
