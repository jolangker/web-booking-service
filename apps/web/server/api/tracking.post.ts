import { trackBooking } from '@booking/core'
import { adminBody, adminOperation, checkOrigin } from '../utils/admin'
import { runtime } from '../utils/runtime'

export default defineEventHandler(event => adminOperation(async () => {
  checkOrigin(event)
  return trackBooking(runtime, await adminBody(event))
}))
