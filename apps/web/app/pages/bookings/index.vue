<script setup lang="ts">
useHead({ title: 'Booking saya — Booking bengkel' })
const request = useRequestFetch()
const { data, error, refresh, status } = await useAsyncData('my-bookings', () => request<{ bookings: CustomerBooking[] }>('/api/customer/bookings'))
</script>

<template>
  <main class="admin customer-account">
    <header class="page-heading admin-header"><div><h1>Booking saya</h1><p>Rencana kedatangan dan perkembangan kunjungan Anda.</p></div><NuxtLink to="/bookings/new" class="button"><AppIcon name="plus" />Booking servis</NuxtLink></header>
    <p v-if="error" class="notice error" role="alert">{{ adminError(error) }} <button @click="refresh()">Coba lagi</button></p>
    <p v-if="status === 'pending'" role="status">Memuat booking…</p>
    <div v-else-if="data && !data.bookings.length" class="empty-state"><AppIcon name="calendar-days" /><h2>Belum ada rencana kunjungan</h2><p>Pilih layanan dan jadwal untuk servis kendaraan Anda berikutnya.</p><NuxtLink to="/bookings/new" class="button">Buat booking pertama<AppIcon name="arrow-right" /></NuxtLink></div>
    <ul v-if="data" class="booking-list"><li v-for="b in data.bookings" :key="b.id" class="panel">
      <div class="booking-card-top"><div><h2><NuxtLink :to="`/bookings/${b.id}`">{{ b.code }}</NuxtLink></h2><p>{{ b.vehicle.brand }} {{ b.vehicle.model }}</p></div><span class="badge" :class="{ inactive: b.reservationStatus === 'cancelled', pending: b.status === 'completed' }">{{ bookingStatus(b.status, b.reservationStatus) }}</span></div>
      <div class="booking-card-info"><div><AppIcon name="calendar-days" /><span><small>Jadwal kedatangan</small><strong>{{ bookingTime(b.scheduledAt) }}</strong></span></div><div><AppIcon name="car" /><span><small>Kendaraan</small><strong>{{ b.vehicle.plate }}</strong></span></div><div><AppIcon name="credit-card" /><span><small>Estimasi jasa</small><strong>{{ bookingMoney(b.estimatedTotal) }}</strong></span></div></div>
      <div class="booking-card-actions"><div v-if="b.canManage" class="actions"><NuxtLink :to="`/bookings/${b.id}?action=reschedule`">Ubah jadwal</NuxtLink><NuxtLink :to="`/bookings/${b.id}?action=cancel`">Batalkan reservasi</NuxtLink></div><NuxtLink :to="`/bookings/${b.id}`" class="text-link">Lihat detail<AppIcon name="arrow-right" /></NuxtLink></div>
    </li></ul>
    <p v-if="data?.bookings.length === 100" class="muted">Menampilkan 100 booking terbaru.</p>
  </main>
</template>
