import type { InvoiceSnapshot } from '@booking/core'

export interface HistoryVehicle { id: string, plate: string, brand: string, model: string, year: number, visits: number }
export interface HistoryVisit { id: string, invoiceId: string, number: string, paidAt: string, vehicle: HistoryVehicle, odometer: number, total: number, lines: InvoiceSnapshot['lines'], pdfStatus: string }
export interface HistoryInvoice {
  invoice: { id: string, number: string, status: string, snapshot: InvoiceSnapshot },
  visit: { vehicleId: string, complaint: string, scheduledAt: string, receivedAt: string, diagnosis: string, inspection: string, initialCondition: string, notes: string, history: { action: string, occurredAt: string }[] },
}
export function useHistory() {
  const route = useRoute()
  async function read<T>(path: string) {
    try { return await $fetch<T>(path) }
    catch (e) {
      if ((e as { status?: number }).status === 401) await navigateTo({ path: '/login', query: { returnTo: route.path } })
      throw e
    }
  }
  return { read }
}
