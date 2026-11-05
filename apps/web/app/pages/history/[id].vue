<script setup lang="ts">
const route = useRoute(), { read } = useHistory(), result = ref<{ vehicle: HistoryVehicle, visits: HistoryVisit[], page: number, hasMore: boolean }>()
const page = ref(1), error = ref(''), loading = ref(false)
async function load(next = 1) {
  loading.value = true; error.value = ''
  try { result.value = await read(`/api/customer/history/${route.params.id}?page=${next}`); page.value = next }
  catch (e) { error.value = adminError(e) }
  finally { loading.value = false }
}
onMounted(() => load())
</script>

<template>
  <main class="admin customer-account">
    <p><NuxtLink to="/history">Semua kendaraan</NuxtLink></p><h1>Riwayat {{ result?.vehicle.plate }}</h1>
    <p v-if="loading" role="status">Memuat riwayat…</p><p v-if="error" role="alert" class="notice error">{{ error }}</p><button v-if="error" @click="load(page)">Coba lagi</button>
    <template v-if="result">
      <p v-if="!result.visits.length && !loading">Belum ada kunjungan lunas untuk kendaraan ini.</p>
      <ol class="booking-list"><li v-for="v in result.visits" :key="v.id" class="panel">
        <h2><NuxtLink :to="`/invoices/${v.invoiceId}`" :data-history-invoice="v.invoiceId">{{ bookingTime(v.paidAt) }}</NuxtLink></h2>
        <p>{{ v.vehicle.plate }} · {{ v.odometer }} km · {{ v.number }}</p>
        <ul><li v-for="(line, index) in v.lines" :key="index">{{ line.description }} × {{ line.quantity }}</li></ul>
        <p>LUNAS · {{ bookingMoney(v.total) }}</p><NuxtLink :to="`/invoices/${v.invoiceId}`">Detail pekerjaan & invoice</NuxtLink>
      </li></ol>
      <div class="actions"><button v-if="page > 1" :disabled="loading" @click="load(page - 1)">Lebih baru</button><span>Halaman {{ page }}</span><button v-if="result.hasMore" :disabled="loading" @click="load(page + 1)">Lebih lama</button></div>
    </template>
  </main>
</template>
