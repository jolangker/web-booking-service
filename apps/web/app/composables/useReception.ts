export interface ReceptionPhysical { odometer: number | '', initialCondition: string, pit: string, assignee: string }
export interface ReceptionSlot { id: string, startMinute: number, endMinute: number, remaining: number, quota: number, reserved: number, canWalkIn: boolean }
export interface ReceptionBooking {
  id: string, code: string, version: number, status: string, reservationStatus: string, scheduledAt: string,
  vehicle: { plate: string, brand: string, model: string, year: number }, customerName: string, phone: string, complaint: string,
  services: { name: string, price: number }[], workOrderId: string | null, odometer: number | null, initialCondition: string | null,
  pit: string | null, assignee: string | null, receivedAt: string | null,
}
export interface ReceptionResult { workOrder: { id: string, bookingId: string, code: string }, replayed: boolean }

// Keep the exact submitted payload through network failures and a tab refresh. Never silently submit edited data with a used key.
export function useReceptionSubmit(storageKey: string, saved: (result: ReceptionResult) => void) {
  const { request } = useAdmin()
  const pending = ref<{ url: string, body: Record<string, unknown> }>(), busy = ref(false), error = ref('')
  onMounted(() => {
    const stored = sessionStorage.getItem(storageKey)
    if (stored) {
      try { pending.value = JSON.parse(stored) }
      catch { sessionStorage.removeItem(storageKey) }
    }
  })
  async function submit(url?: string, body?: Record<string, unknown>) {
    if (busy.value) return
    if (!pending.value && url && body) {
      pending.value = { url, body: { ...body, idempotencyKey: crypto.randomUUID() } }
      sessionStorage.setItem(storageKey, JSON.stringify(pending.value))
    }
    if (!pending.value) return
    busy.value = true; error.value = ''
    try {
      const result = await request<ReceptionResult>(pending.value.url, 'POST', pending.value.body)
      pending.value = undefined; sessionStorage.removeItem(storageKey); saved(result)
    } catch (e) {
      error.value = adminError(e)
      const status = (e as { statusCode?: number }).statusCode
      if (status && status >= 400 && status < 500) { pending.value = undefined; sessionStorage.removeItem(storageKey) }
    } finally { busy.value = false }
  }
  return { pending, busy, error, submit }
}
