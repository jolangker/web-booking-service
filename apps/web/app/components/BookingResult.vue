<script setup lang="ts">
defineProps<{ booking: CustomerBooking }>()
const deliveryStatus = (status: string) => ({ queued: 'Menunggu pengiriman', retrying: 'Menunggu percobaan ulang', sending: 'Sedang dikirim', accepted: 'Diterima gateway', sent: 'Terkirim', delivered: 'Sampai ke penerima', read: 'Dibaca', failed: 'Gagal dikirim', unknown: 'Belum dapat dipastikan', stale: 'Tidak dikirim: jadwal berubah/kedaluwarsa' })[status] ?? status
</script>

<template>
  <section class="panel booking-result" aria-labelledby="booking-code">
    <p class="badge">{{ bookingStatus(booking.status) }}</p>
    <h2 id="booking-code">{{ booking.code }}</h2>
    <p>{{ bookingTime(booking.scheduledAt) }}</p>
    <img :src="booking.qrDataUrl" width="256" height="256" :alt="`QR kode booking ${booking.code}`">
    <p>Tunjukkan kode atau QR ini kepada petugas saat datang.</p>
    <p><strong>{{ booking.vehicle.plate }}</strong> · {{ booking.vehicle.brand }} {{ booking.vehicle.model }}</p>
    <p class="booking-complaint">Keluhan: {{ booking.complaint }}</p>
    <ul class="booking-service-list"><li v-for="s in booking.services" :key="s.name">{{ s.name }} <strong>{{ bookingMoney(s.price) }}</strong></li></ul>
    <p>Estimasi jasa <strong>{{ bookingMoney(booking.estimatedTotal) }}</strong> · {{ booking.estimatedMinutes }} menit</p>
    <p class="muted">Biaya akhir mengikuti pekerjaan aktual yang dikonfirmasi bengkel. Jadwal adalah waktu kedatangan.</p>
    <p v-if="booking.trackingUrl"><a :href="booking.trackingUrl" referrerpolicy="no-referrer">Pantau status booking</a></p>
    <p v-else class="muted">Tautan tracking telah berakhir atau dicabut.</p>
    <h3>Notifikasi WhatsApp</h3>
    <ul><li v-for="n in booking.notifications" :key="n.kind">{{ n.kind === 'reminder' ? 'Reminder' : 'Konfirmasi' }}: {{ deliveryStatus(n.status) }}</li></ul>
    <p class="muted">{{ booking.reminderAt ? `Reminder dijadwalkan ${bookingTime(booking.reminderAt)}.` : 'Waktu reminder H-1 pukul 16:00 WIB sudah lewat saat booking dibuat; reminder dilewati.' }} Booking tetap tersimpan meskipun pengiriman WhatsApp mengalami gangguan.</p>
  </section>
</template>
