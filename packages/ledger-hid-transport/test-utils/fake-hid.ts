import type { Device } from 'node-hid'

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

// jest.mock('node-hid') factory, devices are what the operating system lists
export const fakeNodeHid = {
  devices: [] as Device[],
  devicesAsync: (vid: number): Promise<Device[]> =>
    Promise.resolve(fakeNodeHid.devices.filter(d => d.vendorId === vid)),
}
