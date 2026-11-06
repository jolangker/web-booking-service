import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startGatewayPairing, unpairGateway } from '../dist/messaging.js'
import { DomainError } from '../dist/workshop.js'

const env = { wahaBaseUrl: 'http://waha.test:3000', wahaApiKey: 'test-api-key' }
const json = (data, status = 200) => Response.json(data, { status })

test('pair creates and starts the default session when it does not exist', async (t) => {
  const responses = [json({}, 404), json({}), json({ status: 'SCAN_QR_CODE' })]
  const fetch = t.mock.method(globalThis, 'fetch', async () => responses.shift())
  assert.equal((await startGatewayPairing(env)).status, 'SCAN_QR_CODE')
  const [url, options] = fetch.mock.calls[1].arguments
  assert.equal(url.pathname, '/api/sessions')
  assert.equal(options.method, 'POST')
  assert.deepEqual(JSON.parse(options.body), { name: 'default', start: true })
})

test('pair starts a stopped session without recreating it', async (t) => {
  const responses = [json({ status: 'STOPPED' }), json({}), json({ status: 'STARTING' })]
  const fetch = t.mock.method(globalThis, 'fetch', async () => responses.shift())
  assert.equal((await startGatewayPairing(env)).status, 'STARTING')
  assert.equal(fetch.mock.calls[1].arguments[0].pathname, '/api/sessions/default/start')
})

test('pair does not restart or log out an already connected session', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({ status: 'WORKING' }))
  assert.equal((await startGatewayPairing(env)).status, 'WORKING')
  assert.equal(fetch.mock.callCount(), 2)
  assert.ok(fetch.mock.calls.every(call => call.arguments[1].method === 'GET'))
})

test('unpair logs out the default session using the server API key and refreshes its status', async (t) => {
  const responses = [json({}), json({ status: 'SCAN_QR_CODE' })]
  const fetch = t.mock.method(globalThis, 'fetch', async () => responses.shift())
  const result = await unpairGateway(env)
  assert.equal(result.status, 'SCAN_QR_CODE')
  assert.ok(Number.isFinite(Date.parse(result.checkedAt)))
  assert.equal(fetch.mock.callCount(), 2)
  const [url, options] = fetch.mock.calls[0].arguments
  assert.equal(url.href, 'http://waha.test:3000/api/sessions/default/logout')
  assert.equal(options.method, 'POST')
  assert.equal(options.headers['X-Api-Key'], env.wahaApiKey)
  assert.equal(options.body, '{}')
  assert.equal(fetch.mock.calls[1].arguments[0].pathname, '/api/sessions/default')
})

test('unpair tolerates a session that has already been removed', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json({}, 404))
  assert.equal((await unpairGateway(env)).status, 'UNAVAILABLE')
})

test('unpair rejects a gateway error without exposing its response', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({ secret: env.wahaApiKey }, 500))
  await assert.rejects(unpairGateway(env), error => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.status, 503)
    assert.match(error.message, /belum dapat diputuskan/)
    assert.ok(!error.message.includes(env.wahaApiKey))
    return true
  })
  assert.equal(fetch.mock.callCount(), 1)
})

test('unpair handles a gateway connection failure', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Connection failed') })
  await assert.rejects(unpairGateway(env), error => error instanceof DomainError && error.status === 503)
})
