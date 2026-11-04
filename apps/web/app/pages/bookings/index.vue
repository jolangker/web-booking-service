<script setup lang="ts">
const request = useRequestFetch()
const { data, error, refresh, status } = await useAsyncData('my-bookings', () => request<{ bookings: CustomerBooking[] }>('/api/customer/bookings'))
</script>

<template>
  <main class="admin customer-account">
    <header class="admin-header"><div><p class="eyebrow">BOOKING BENGKEL</p><h1>Booking saya</h1></div><NuxtLink to="/account">Akun & kendaraan</NuxtLink></header>
    <p><NuxtLink to="/bookings/new" class="booking-primary-link">Buat booking</NuxtLink></p>
    <p v-if="error" class="notice error" role="alert">{{ adminError(error) }} <button @click="refresh()">Coba lagi</button></p>
    <p v-if="status === 'pending'" role="status">Memuat booking…</p>
    <p v-else-if="data && !data.bookings.length" class="panel">Belum ada booking. Pilih layanan dan jadwal untuk kunjungan Anda.</p>
    <ul v-if="data" class="booking-list"><li v-for="b in data.bookings" :key="b.id" class="panel"><NuxtLink :to="`/bookings/${b.id}`"><strong>{{ b.code }}</strong></NuxtLink><p>{{ bookingStatus(b.status, b.reservationStatus) }}</p><p>{{ bookingTime(b.scheduledAt) }}</p><p>{{ b.vehicle.plate }} · {{ bookingMoney(b.estimatedTotal) }} estimasi jasa</p><div v-if="b.canManage" class="actions"><NuxtLink :to="`/bookings/${b.id}?action=reschedule`">Ubah jadwal</NuxtLink><NuxtLink :to="`/bookings/${b.id}?action=cancel`">Batalkan reservasi</NuxtLink></div></li></ul>
    <p v-if="data?.bookings.length === 100" class="muted">Menampilkan 100 booking terbaru.</p>
  </main>
</template>
