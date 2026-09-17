import assert from 'node:assert/strict'
import { createServer, type AddressInfo, type Socket } from 'node:net'
import Fastify, { type LightMyRequestResponse } from 'fastify'
import type { TelemetrySnapshot } from '../src/shared/contracts'
import type { PlcClockValues, PlcWriteResponse } from '../src/shared/plc'
import { PlcTcpCollector } from '../src/main/server/collector'
import { registerPlcRoutes } from '../src/main/server/plc-routes'

async function until(condition: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 4000
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function run(): Promise<void> {
  const memory = Buffer.alloc(65536 * 2)
  const offset = 10
  memory.writeUInt16BE(2026, 600 + offset * 2)
  memory.set([9, 17, 12, 30, 45, 5], 602 + offset * 2)
  const sockets = new Set<Socket>()
  let connections = 0
  let refusedConnections = 0
  let writes = 0
  let dropWriteAcknowledgement = false
  let rejectRead = false
  let inFlight = false
  const requests: { fn: number; address: number; transactionId: number }[] = []
  const tcp = createServer((socket) => {
    connections++
    if (sockets.size) {
      refusedConnections++
      socket.destroy()
      return
    }
    sockets.add(socket)
    socket.on('close', () => {
      sockets.delete(socket)
      inFlight = false
    })
    socket.on('error', () => {
      /* A closed test connection is expected on failures. */
    })
    let buffer = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 7 && buffer.length >= buffer.readUInt16BE(4) + 6) {
        const size = buffer.readUInt16BE(4) + 6
        const request = buffer.subarray(0, size)
        buffer = buffer.subarray(size)
        assert.equal(inFlight, false, 'Polling and explicit operations must never overlap requests')
        inFlight = true
        const fn = request[7]
        const address = request.readUInt16BE(8)
        const quantity = request.readUInt16BE(10)
        requests.push({ fn, address, transactionId: request.readUInt16BE(0) })
        let response: Buffer
        if (fn === 3) {
          if (rejectRead) response = Buffer.from([0x83, 2])
          else {
            response = Buffer.alloc(2 + quantity * 2)
            response[0] = 3
            response[1] = quantity * 2
            memory.copy(response, 2, address * 2, (address + quantity) * 2)
          }
        } else {
          assert.equal(fn, 16)
          writes++
          request.copy(memory, address * 2, 13)
          if (dropWriteAcknowledgement) {
            inFlight = false
            continue
          }
          response = Buffer.from(request.subarray(7, 12))
        }
        const frame = Buffer.alloc(7 + response.length)
        request.copy(frame, 0, 0, 7)
        frame.writeUInt16BE(response.length + 1, 4)
        response.copy(frame, 7)
        // Delay and fragment replies so a polling tick occurs during API operations.
        socket.write(frame.subarray(0, 4))
        setTimeout(() => {
          inFlight = false
          if (!socket.destroyed) socket.write(frame.subarray(4))
        }, 8)
      }
    })
  })
  await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve))
  const connection = {
    host: '127.0.0.1',
    port: (tcp.address() as AddressInfo).port,
    unitId: 1,
    registerAddressOffset: offset
  }
  const collector = new PlcTcpCollector({
    ...connection,
    pollingIntervalMs: 5,
    reconnectDelayMs: 40,
    requestTimeoutMs: 150
  })
  const snapshots: TelemetrySnapshot[] = []
  const app = Fastify()
  registerPlcRoutes(app, {
    config: { connection, collectorMode: 'plc-tcp' },
    session: collector.session,
    timeoutMs: 150
  })
  const post = (action: string, body: object): Promise<LightMyRequestResponse> =>
    app.inject({
      method: 'POST',
      url: `/api/plc/${action}`,
      headers: { host: 'localhost:17880', 'x-plc-request': '1' },
      payload: body
    })
  try {
    collector.start((snapshot) => snapshots.push(snapshot))
    await until(() => snapshots.length >= 2, 'Polling must start')
    assert.equal(snapshots.at(-1)?.plcConnected, true)
    assert.equal(connections, 1)
    const current = await post('read', { connection })
    assert.equal(current.statusCode, 200)
    assert.equal(current.json().clock.year, 2026)
    assert.equal(connections, 1, 'Reading the clock reuses the sampling connection')

    const clock: PlcClockValues = {
      year: 2028,
      month: 2,
      day: 29,
      hour: 23,
      minute: 58,
      second: 57,
      weekday: 3
    }
    const beforeWrite = Buffer.from(memory)
    await until(() => inFlight, 'Start write while a poll is in progress')
    const pendingWrite = post('write', { connection, clock })
    const written = (await pendingWrite).json<PlcWriteResponse>()
    assert.equal(written.ok, true, written.message)
    assert.equal(written.results[0].status, 'verified')
    assert.deepEqual(written.snapshot?.clock, clock)
    assert.deepEqual(written.results[0].actual, clock)
    assert.equal(writes, 1)
    assert.equal(connections, 1, 'Debugging must not open a second connection')
    assert.equal(refusedConnections, 0)
    assert.deepEqual(
      memory.subarray(0, 600 + offset * 2),
      beforeWrite.subarray(0, 600 + offset * 2)
    )
    assert.deepEqual(memory.subarray(608 + offset * 2), beforeWrite.subarray(608 + offset * 2))
    const writeIndex = requests.findIndex((item) => item.fn === 16)
    assert.deepEqual(
      requests.slice(writeIndex, writeIndex + 2).map(({ fn, address }) => ({ fn, address })),
      [
        { fn: 16, address: 310 },
        { fn: 3, address: 310 }
      ],
      'Write and verification cannot be separated by a sampling request'
    )
    await until(
      () => snapshots.at(-1)?.plcClock?.year === 2028,
      'Polling must publish the saved clock'
    )
    assert.ok(
      snapshots.every((item) => item.plcConnected),
      'Queued writes must not create offline events'
    )
    console.log('PASS: a single TCP connection supports polling and clock write/readback')

    // Long-lived connections must wrap the two-byte transaction counter.
    await collector.session.run(async (client) => {
      Object.assign(client, { transactionId: 65534 })
      await client.read(300, 4)
      await client.read(300, 4)
      assert.deepEqual(
        requests.slice(-2).map((item) => item.transactionId),
        [65535, 1]
      )
    })
    assert.equal(connections, 1)
    assert.equal(collector.session.matches({ ...connection, unitId: 2 }), false)
    assert.equal(collector.session.matches({ ...connection, registerAddressOffset: 0 }), false)
    assert.equal(collector.session.matches({ ...connection, port: connection.port + 1 }), false)
    console.log('PASS: persistent transaction rollover and exact connection matching')

    dropWriteAcknowledgement = true
    const unknown = (
      await post('write', { connection, clock: { ...clock, second: 30 } })
    ).json<PlcWriteResponse>()
    assert.equal(unknown.ok, false)
    assert.equal(unknown.results[0].status, 'unknown')
    dropWriteAcknowledgement = false
    await until(
      () => snapshots.at(-1)?.plcClock?.second === 30,
      'Sampling must recover after a lost acknowledgement'
    )
    assert.equal(writes, 2, 'An unconfirmed write must never be retried automatically')
    assert.ok(connections >= 2, 'Reconnect after the failed socket')
    // The peer may briefly refuse a reconnect before it observes the old socket closing.
    // The healthy-connection assertions above forbid extra connections; recovery is eventual.
    assert.equal(sockets.size, 1, 'Recovery leaves exactly one active connection')
    console.log('PASS: lost acknowledgement reconnects sampling without repeating the write')

    rejectRead = true
    await until(
      () => snapshots.at(-1)?.plcConnected === false,
      'Protocol failures mark sampling offline'
    )
    const beforeRecover = snapshots.length
    rejectRead = false
    await until(
      () => snapshots.length > beforeRecover && snapshots.at(-1)?.plcConnected === true,
      'Sampling reconnects after a protocol failure'
    )
    assert.equal((await post('read', { connection })).statusCode, 200)
    console.log('PASS: protocol errors release the queue and sampling recovers')

    let release: (() => void) | undefined
    const holding = collector.session.run(
      async () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    await until(() => Boolean(release), 'Hold the operation queue')
    let queuedExecuted = false
    const queued = collector.session.run(async () => {
      queuedExecuted = true
    })
    const cancelled = assert.rejects(queued, /已停止/)
    collector.stop()
    release!()
    await holding
    await cancelled
    assert.equal(queuedExecuted, false, 'Stopped sessions discard queued work before it can write')
    await until(() => sockets.size === 0, 'Stop closes the shared TCP connection')
    const atStop = snapshots.length
    await new Promise((resolve) => setTimeout(resolve, 60))
    assert.equal(snapshots.length, atStop)
    collector.start((snapshot) => snapshots.push(snapshot))
    await until(
      () => snapshots.length > atStop && snapshots.at(-1)?.plcConnected === true,
      'Collector can restart without old queued jobs'
    )
    assert.equal(writes, 2)
    console.log('PASS: stopping cancels queued operations and restart resumes sampling')
  } finally {
    collector.stop()
    await app.close()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve, reject) =>
      tcp.close((error) => (error ? reject(error) : resolve()))
    )
  }
}

void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
