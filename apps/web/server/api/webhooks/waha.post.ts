import { receiveDeliveryEvent, verifyWebhookSignature } from '@booking/core'
import { adminOperation } from '../../utils/admin'
import { environment, runtime } from '../../utils/runtime'

export default defineEventHandler(event => adminOperation(async () => {
  setHeader(event, 'Cache-Control', 'no-store')
  if (Number(getHeader(event, 'content-length') ?? 0) > 65536) throw createError({ statusCode: 413, statusMessage: 'Payload terlalu besar.' })
  const raw = await readRawBody(event)
  if (!raw || Buffer.byteLength(raw) > 65536) throw createError({ statusCode: 413, statusMessage: 'Payload kosong atau terlalu besar.' })
  if (!verifyWebhookSignature(raw, getHeader(event, 'x-webhook-hmac'), getHeader(event, 'x-webhook-hmac-algorithm'), environment.wahaWebhookSecret)) throw createError({ statusCode: 401, statusMessage: 'Signature tidak valid.' })
  let value: unknown
  try { value = JSON.parse(raw) }
  catch { throw createError({ statusCode: 400, statusMessage: 'JSON tidak valid.' }) }
  return receiveDeliveryEvent(runtime, value)
}))
