<script setup lang="ts">
useHead({ title: 'Buku servis — Booking bengkel' })
const { read } = useHistory(), vehicles = ref<HistoryVehicle[]>([]), error = ref(''), loading = ref(true)
async function load() {
  loading.value = true; error.value = ''
  try { vehicles.value = (await read<{ vehicles: HistoryVehicle[] }>('/api/customer/history')).vehicles }
  catch (e) { error.value = adminError(e) }
  finally { loading.value = false }
}
onMounted(load)
</script>

<template>
  <main class="admin customer-account">
    <header class="page-heading"><h1>Buku servis</h1><p>Catatan perawatan dan invoice untuk setiap kendaraan Anda.</p></header>
    <nav class="customer-links" aria-label="Tautan buku servis"><NuxtLink to="/account">Kelola kendaraan</NuxtLink><NuxtLink to="/bookings">Booking saya</NuxtLink></nav>
    <p class="page-note">Pilih kendaraan untuk melihat kunjungan yang sudah lunas dan rincian pekerjaannya.</p>
    <p v-if="loading" role="status">Memuat kendaraan…</p>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p><button v-if="error" @click="load">Coba lagi</button>
    <div v-if="!loading && !error && !vehicles.length" class="empty-state"><AppIcon name="car" /><h2>Buku servis Anda dimulai di sini</h2><p>Tambahkan kendaraan. Riwayat akan muncul setelah kunjungan selesai dan pembayaran lunas.</p><NuxtLink to="/account" class="button">Tambahkan kendaraan<AppIcon name="plus" /></NuxtLink></div>
    <ul class="booking-list"><li v-for="v in vehicles" :key="v.id" class="panel">
      <div class="vehicle-heading"><AppIcon name="car" /><div><h2><NuxtLink :to="`/history/${v.id}`" :data-history-vehicle="v.id">{{ v.plate }}</NuxtLink></h2><p>{{ v.brand }} {{ v.model }} · {{ v.year }}</p></div></div><div class="booking-card-actions section-actions"><span class="badge inactive">{{ v.visits }} kunjungan lunas</span><NuxtLink :to="`/history/${v.id}`" class="text-link">Lihat riwayat<AppIcon name="arrow-right" /></NuxtLink></div>
    </li></ul>
  </main>
</template>
