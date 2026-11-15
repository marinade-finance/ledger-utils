import { closeSync, constants, openSync, readSync, writeSync } from 'node:fs'

// struct uhid_event of linux/uhid.h, packed, little-endian
const EVENT_SIZE = 4376
const UHID_DESTROY = 1
const UHID_OUTPUT = 6
const UHID_CREATE2 = 11
const UHID_INPUT2 = 12
const BUS_USB = 3
const FRAME_SIZE = 64
// usage page 0xffa0 with one 64 byte input and one 64 byte output report, as the Ledger firmware
const REPORT_DESCRIPTOR = Buffer.from(
  '06a0ff0901a1010903150026ff007508954081080904150026ff00750895409108c0',
  'hex',
)

export type UhidLedger = { destroy(): void }

// a virtual Ledger Nano S Plus on /dev/uhid: deframes host writes, forwards the APDU, frames the reply
export function createUhidLedger(
  forward: (apdu: Buffer) => Promise<Buffer>,
): UhidLedger {
  const fd = openSync('/dev/uhid', constants.O_RDWR | constants.O_NONBLOCK)
  const create = Buffer.alloc(EVENT_SIZE)
  create.writeUInt32LE(UHID_CREATE2, 0)
  create.write('Ledger Nano S Plus (uhid test)', 4)
  create.writeUInt16LE(REPORT_DESCRIPTOR.length, 260)
  create.writeUInt16LE(BUS_USB, 262)
  create.writeUInt32LE(0x2c97, 264)
  create.writeUInt32LE(0x5011, 268)
  REPORT_DESCRIPTOR.copy(create, 280)
  writeSync(fd, create)

  let request: { length: number; data: Buffer } | undefined
  const onFrame = (frame: Buffer): void => {
    const channel = frame.readUInt16BE(0)
    if (frame.readUInt16BE(3) === 0) {
      // frame is a view of the reused event buffer, the next read overwrites it
      request = {
        length: frame.readUInt16BE(5),
        data: Buffer.from(frame.subarray(7)),
      }
    } else if (request !== undefined) {
      request.data = Buffer.concat([request.data, frame.subarray(5)])
    }
    if (request !== undefined && request.data.length >= request.length) {
      const apdu = request.data.subarray(0, request.length)
      request = undefined
      void forward(apdu).then(response => {
        for (const reply of frameResponse(channel, response)) {
          const input = Buffer.alloc(EVENT_SIZE)
          input.writeUInt32LE(UHID_INPUT2, 0)
          input.writeUInt16LE(FRAME_SIZE, 4)
          reply.copy(input, 6)
          writeSync(fd, input)
        }
      })
    }
  }

  const event = Buffer.alloc(EVENT_SIZE)
  const poll = setInterval(() => {
    for (;;) {
      try {
        readSync(fd, event)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EAGAIN') {
          return
        }
        throw e
      }
      if (event.readUInt32LE(0) === UHID_OUTPUT) {
        const size = event.readUInt16LE(4 + 4096)
        // the host may pass the report id 0 of a device without report ids
        const data = event.subarray(4, 4 + size)
        onFrame(size === FRAME_SIZE + 1 ? data.subarray(1) : data)
      }
    }
  }, 5)

  return {
    destroy() {
      clearInterval(poll)
      const destroy = Buffer.alloc(EVENT_SIZE)
      destroy.writeUInt32LE(UHID_DESTROY, 0)
      writeSync(fd, destroy)
      closeSync(fd)
    },
  }
}

function frameResponse(channel: number, response: Buffer): Buffer[] {
  const data = Buffer.concat([Buffer.alloc(2), response])
  data.writeUInt16BE(response.length, 0)
  const frames: Buffer[] = []
  for (
    let offset = 0, i = 0;
    offset < data.length;
    offset += FRAME_SIZE - 5, i++
  ) {
    const frame = Buffer.alloc(FRAME_SIZE)
    frame.writeUInt16BE(channel, 0)
    frame[2] = 0x05
    frame.writeUInt16BE(i, 3)
    data.copy(frame, 5, offset, offset + FRAME_SIZE - 5)
    frames.push(frame)
  }
  return frames
}
