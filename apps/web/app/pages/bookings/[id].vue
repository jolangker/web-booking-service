<script setup lang="ts">
const route = useRoute(), request = useRequestFetch()
const { data, error, refresh } = await useAsyncData(`booking-${route.params.id}`, () => request<{ booking: CustomerBooking }>(`/api/customer/bookings/${encodeURIComponent(String(route.params.id))}`))
</script>

<template>
  <main class="admin customer-account">
    <header class="admin-header"><h1>Detail booking</h1><NuxtLink to="/bookings">Booking saya</NuxtLink></header>
    <p v-if="error" class="notice error" role="alert">{{ adminError(error) }} <button @click="refresh()">Coba lagi</button></p>
    <BookingResult v-if="data" :booking="data.booking" />
    <button v-if="data" class="section-actions" @click="refresh()">Perbarui status notifikasi</button>
  </main>
</template>
