export interface BookingService { id: string, name: string, price: number, durationMinutes: number }
export interface BookingVehicle { id: string, plate: string, brand: string, model: string, year: number }
export interface CustomerBooking {
  id: string, code: string, status: string, version: number, scheduledAt: string, createdAt: string,
  complaint: string, vehicle: Omit<BookingVehicle, 'id'>, estimatedTotal: number, estimatedMinutes: number,
  reminderAt: string | null, services: Omit<BookingService, 'id'>[], notifications: { kind: string, status: string }[],
  trackingUrl: string | null, qrPayload: string, qrDataUrl: string,
}
export const bookingStatus = (status: string) => ({ confirmed: 'Booking Terkonfirmasi', received: 'Kendaraan Diterima', in_progress: 'Sedang Dikerjakan', completed: 'Selesai Dikerjakan', collected: 'Siap Diambil / Transaksi Selesai', cancelled: 'Dibatalkan' })[status] ?? status
export const bookingMoney = (value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value)
export const bookingTime = (value: string) => new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'short' }) + ' WIB'
export const slotTime = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
