export interface BookingService { id: string, name: string, price: number, durationMinutes: number }
export interface BookingVehicle { id: string, plate: string, brand: string, model: string, year: number }
export interface CustomerBooking {
  id: string, slotId: string, code: string, status: string, reservationStatus: 'active' | 'cancelled', canManage: boolean, version: number, scheduledAt: string, createdAt: string,
  complaint: string, vehicle: Omit<BookingVehicle, 'id'>, estimatedTotal: number, estimatedMinutes: number,
  reminderAt: string | null, services: Omit<BookingService, 'id'>[], notifications: { id: string, kind: string, status: string, version: number }[],
  history: { version: number, status: string, reservationStatus: string, action: string, scheduledAt: string, previousScheduledAt: string | null, occurredAt: string }[],
  trackingUrl: string | null, qrPayload: string, qrDataUrl: string,
}
export const bookingStatus = (status: string, reservationStatus = 'active') => reservationStatus === 'cancelled' ? 'Reservasi Dibatalkan' : ({ confirmed: 'Booking Terkonfirmasi', received: 'Kendaraan Diterima', in_progress: 'Sedang Dikerjakan', completed: 'Selesai Dikerjakan', collected: 'Siap Diambil / Transaksi Selesai' })[status] ?? status
export const bookingAction = (action: string) => ({ created: 'Booking dibuat', rescheduled: 'Jadwal diubah', cancelled: 'Reservasi dibatalkan', received: 'Kendaraan Diterima', in_progress: 'Sedang Dikerjakan', completed: 'Selesai Dikerjakan', collected: 'Pembayaran LUNAS / Transaksi Selesai' })[action] ?? action
export const bookingMoney = (value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value)
export const bookingTime = (value: string) => new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'short' }) + ' WIB'
export const slotTime = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
