<script setup lang="ts">
defineProps<{ booking: CustomerBooking }>()
const deliveryStatus = (status: string) => ({ queued: 'Menunggu pengiriman', retrying: 'Menunggu percobaan ulang', sending: 'Sedang dikirim', accepted: 'Diterima gateway', sent: 'Terkirim', delivered: 'Sampai ke penerima', read: 'Dibaca', failed: 'Gagal dikirim', unknown: 'Belum dapat dipastikan', stale: 'Tidak dikirim: jadwal berubah/kedaluwarsa' })[status] ?? status
</script>

<template>
  <section class="panel booking-result" aria-labelledby="booking-code">
    <div class="confirmation-head">
      <div><span class="badge" :class="{ inactive: booking.reservationStatus === 'cancelled', pending: booking.status === 'completed' }">{{ bookingStatus(booking.status, booking.reservationStatus) }}</span><h2 id="booking-code">{{ booking.code }}</h2><p class="booking-time"><AppIcon name="calendar-days" />{{ bookingTime(booking.scheduledAt) }}</p><p class="page-note">{{ booking.reservationStatus === 'cancelled' ? 'Reservasi ini sudah dibatalkan. Buat booking baru jika ingin datang.' : 'Tunjukkan kode atau QR ini kepada petugas saat datang.' }}</p></div>
      <img :src="booking.qrDataUrl" width="180" height="180" :alt="`QR kode booking ${booking.code}`">
    </div>
    <VisitProgress :status="booking.status" :reservation-status="booking.reservationStatus" />
    <dl class="detail-grid"><div><dt>Kendaraan</dt><dd>{{ booking.vehicle.plate }}<br><span class="page-note">{{ booking.vehicle.brand }} {{ booking.vehicle.model }}</span></dd></div><div><dt>Keluhan atau kebutuhan servis</dt><dd class="booking-complaint">{{ booking.complaint }}</dd></div></dl>
    <h3>Layanan yang dipilih</h3><ul class="booking-service-list"><li v-for="s in booking.services" :key="s.name"><span>{{ s.name }}</span><strong>{{ bookingMoney(s.price) }}</strong></li></ul>
    <div class="money-summary"><span>Estimasi jasa · {{ booking.estimatedMinutes }} menit</span><strong>{{ bookingMoney(booking.estimatedTotal) }}</strong></div><p class="muted">Biaya akhir mengikuti pekerjaan aktual yang dikonfirmasi bengkel. Jadwal adalah waktu kedatangan.</p>
    <p v-if="booking.status === 'completed'" class="notice">Pengerjaan selesai. Pembayaran belum lunas; selesaikan pembayaran di bengkel.</p>
    <p v-if="booking.trackingUrl"><a :href="booking.trackingUrl" class="text-link" referrerpolicy="no-referrer">Pantau status booking<AppIcon name="arrow-right" /></a></p><p v-else class="muted">Tautan tracking telah berakhir atau dicabut.</p>
    <details class="section-actions"><summary>Notifikasi WhatsApp</summary><ul><li v-for="n in booking.notifications" :key="n.id">{{ n.kind === 'received' ? 'Kendaraan Diterima' : n.kind === 'reminder' ? 'Reminder' : 'Konfirmasi' }} (versi {{ n.version }}): {{ deliveryStatus(n.status) }}</li></ul>
      <p v-if="booking.reservationStatus === 'cancelled'" class="muted">Reminder reservasi dibatalkan.</p><p v-else-if="booking.status !== 'confirmed'" class="muted">Kendaraan sudah diterima bengkel. Reminder kedatangan dihentikan.</p><p v-else class="muted">{{ booking.reminderAt ? `Reminder dijadwalkan ${bookingTime(booking.reminderAt)}.` : 'Waktu reminder H-1 pukul 16:00 WIB sudah lewat; reminder dilewati.' }}</p>
    </details>
    <p class="page-note">Booking yang tersimpan tetap berlaku meskipun pengiriman WhatsApp mengalami gangguan.</p>
    <h3 class="section-actions">Riwayat booking</h3><ol class="customer-timeline"><li v-for="h in booking.history" :key="h.version"><strong>{{ bookingAction(h.action) }}</strong><p>{{ bookingTime(h.occurredAt) }}</p><p v-if="h.action === 'rescheduled'">{{ h.previousScheduledAt ? bookingTime(h.previousScheduledAt) : '' }} → {{ bookingTime(h.scheduledAt) }}</p></li></ol>
  </section>
</template>
