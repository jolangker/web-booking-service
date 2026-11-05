<script setup lang="ts">
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
    <p class="eyebrow">BOOKING BENGKEL · PELANGGAN</p><h1>Buku servis</h1>
    <p><NuxtLink to="/account">Akun & kendaraan</NuxtLink> · <NuxtLink to="/bookings">Booking saya</NuxtLink></p>
    <p>Pilih kendaraan untuk membaca riwayat servis yang sudah lunas. Unduh invoice hanya saat diperlukan.</p>
    <p v-if="loading" role="status">Memuat kendaraan…</p>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p><button v-if="error" @click="load">Coba lagi</button>
    <p v-if="!loading && !error && !vehicles.length">Belum ada kendaraan. Tambahkan kendaraan melalui halaman akun.</p>
    <ul class="booking-list"><li v-for="v in vehicles" :key="v.id" class="panel">
      <h2><NuxtLink :to="`/history/${v.id}`" :data-history-vehicle="v.id">{{ v.plate }}</NuxtLink></h2>
      <p>{{ v.brand }} {{ v.model }} · {{ v.year }}</p><p>{{ v.visits }} kunjungan lunas</p>
    </li></ul>
  </main>
</template>
