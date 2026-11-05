<script setup lang="ts">
const gateway = ref<{ status: string, checkedAt: string }>(), error = ref(''), busy = ref(false)
const notifications = ref<{ id: string, queueJobId: string, status: string, recipient: string, purpose: string, bookingCode: string | null, invoiceNumber: string | null, createdAt: string, attempts: { id: string, outcome: string, httpStatus: number | null }[] }[]>([])
async function load() {
  busy.value = true; error.value = ''
  const results = await Promise.allSettled([
    $fetch<{ status: string, checkedAt: string }>('/api/admin/gateway'),
    $fetch<{ notifications: typeof notifications.value }>('/api/admin/deliveries'),
  ])
  if (results[0].status === 'fulfilled') gateway.value = results[0].value
  else error.value = adminError(results[0].reason)
  if (results[1].status === 'fulfilled') notifications.value = results[1].value.notifications
  else error.value = adminError(results[1].reason)
  busy.value = false
}
onMounted(load)
</script>

<template>
  <section class="panel">
    <div class="admin-header"><h2>WhatsApp gateway</h2><button :disabled="busy" @click="load">{{ busy ? 'Memuat…' : 'Baca status terbaru' }}</button></div>
    <p v-if="error" role="alert" class="notice error">{{ error }}</p>
    <p v-if="gateway" role="status">Sesi default: <strong>{{ gateway.status }}</strong> · Diperiksa {{ new Date(gateway.checkedAt).toLocaleString('id-ID') }}</p>
    <p class="muted">WORKING berarti terhubung. Pairing/reconnect dilakukan operator melalui runbook. Status accepted hanya berarti API gateway menerima request; delivered/read berasal dari webhook.</p>
    <h3>50 notifikasi terakhir</h3>
    <p v-if="!notifications.length && !busy">Belum ada pengiriman.</p>
    <div class="table-scroll"><table v-if="notifications.length"><thead><tr><th>Waktu / korelasi</th><th>Penerima</th><th>Status</th><th>Attempt</th></tr></thead><tbody>
      <tr v-for="item in notifications" :key="item.id"><td>{{ new Date(item.createdAt).toLocaleString('id-ID') }}<p>{{ item.purpose }}<span v-if="item.bookingCode"> · {{ item.bookingCode }}</span><span v-if="item.invoiceNumber"> · {{ item.invoiceNumber }}</span></p><details><summary>ID pengiriman</summary><p>{{ item.id }}</p><p>Job: {{ item.queueJobId }}</p></details></td><td>{{ item.recipient }}</td><td>{{ item.status }}</td><td><ul><li v-for="(attempt, i) in item.attempts" :key="attempt.id">{{ i + 1 }}: {{ attempt.outcome }}{{ attempt.httpStatus ? ` (HTTP ${attempt.httpStatus})` : '' }}</li></ul><span v-if="!item.attempts.length">Belum ada attempt</span></td></tr>
    </tbody></table></div>
  </section>
</template>
