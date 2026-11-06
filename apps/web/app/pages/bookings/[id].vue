<script setup lang="ts">
const route = useRoute(), request = useRequestFetch()
const { data, error, refresh } = await useAsyncData(`booking-${route.params.id}`, () => request<{ booking: CustomerBooking }>(`/api/customer/bookings/${encodeURIComponent(String(route.params.id))}`))
</script>

<template>
  <main class="admin customer-account">
    <NuxtLink to="/bookings" class="back-link"><AppIcon name="arrow-right" />Booking saya</NuxtLink><header class="page-heading"><h1>Detail booking</h1><p>Kode kedatangan, rincian layanan, dan status kunjungan Anda.</p></header>
    <p v-if="error" class="notice error" role="alert">{{ adminError(error) }} <button @click="refresh()">Coba lagi</button></p>
    <BookingResult v-if="data" :booking="data.booking" />
    <BookingManager v-if="data" :booking="data.booking" @updated="data = { booking: $event }" @refresh="refresh()" />
    <button v-if="data" class="section-actions" @click="refresh()">Perbarui status notifikasi</button>
  </main>
</template>
