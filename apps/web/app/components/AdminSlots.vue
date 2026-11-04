<script setup lang="ts">
interface Slot { id: string, startMinute: number, endMinute: number, quota: number, quotaOverride: number | null, reserved: number, remaining: number }
const { request } = useAdmin()
const date = ref(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
const minDate = date.value
const maxDate = new Date(`${minDate}T00:00:00Z`); maxDate.setUTCDate(maxDate.getUTCDate() + 14)
const max = maxDate.toISOString().slice(0, 10)
const slots = ref<Slot[]>([]), loading = ref(true), busy = ref(''), error = ref(''), message = ref('')
const quotas = ref<Record<string, number>>({})
const version = ref(0)
async function load() {
  loading.value = true; error.value = ''; message.value = ''
  try {
    const result = await $fetch<{ slots: Slot[], version: number }>('/api/admin/slots', { query: { date: date.value } })
    version.value = result.version
    slots.value = result.slots; quotas.value = Object.fromEntries(result.slots.map(s => [s.id, s.quota]))
  } catch (e) { slots.value = []; error.value = adminError(e) }
  finally { loading.value = false }
}
onMounted(load)
async function save(s: Slot, reset = false) {
  busy.value = s.id; error.value = ''; message.value = ''
  try {
    await request(`/api/admin/slots/${s.id}/quota`, 'PUT', { quota: reset ? null : quotas.value[s.id], version: version.value })
    await load(); message.value = reset ? 'Kuota kembali mengikuti kalender.' : 'Kuota slot tersimpan.'
  } catch (e) { error.value = adminError(e) }
  finally { busy.value = '' }
}
const time = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
</script>

<template>
  <section aria-labelledby="slots-title">
    <h2 id="slots-title">Preview slot & kuota</h2>
    <p class="muted">Hari ini sampai H+14, dalam WIB. Satu booking memakai satu kuota kedatangan. Kuota 0 menutup penerimaan pada slot tersebut.</p>
    <form class="form-row panel" @submit.prevent="load"><label>Tanggal<input v-model="date" type="date" required :min="minDate" :max="max" :disabled="loading || !!busy" @change="load"></label><button :disabled="loading || !!busy">Tampilkan slot</button></form>
    <p v-if="error" role="alert" class="notice error">{{ error }} <button @click="load">Coba lagi</button></p>
    <p v-if="message" role="status" class="notice success">{{ message }}</p>
    <p v-if="loading" role="status">Memuat slot…</p>
    <p v-else-if="!error && !slots.length" class="panel">Tidak ada slot. Periksa jam buka, istirahat, atau hari libur pada kalender.</p>
    <div v-else class="slot-grid section-actions">
      <form v-for="s in slots" :key="s.id" class="panel slot-card" :class="{ full: !s.remaining }" @submit.prevent="save(s)">
        <h3>{{ time(s.startMinute) }}–{{ time(s.endMinute) }}</h3>
        <span class="badge" :class="{ inactive: !s.remaining }">{{ s.remaining ? `Tersisa ${s.remaining}` : 'Penuh / tidak tersedia' }}</span>
        <p>{{ s.reserved }} terisi / {{ s.quota }} kuota</p>
        <label>Kuota<input v-model.number="quotas[s.id]" type="number" required min="0" max="1000" step="1" :aria-label="`Kuota slot ${time(s.startMinute)}`" :disabled="!!busy"></label>
        <small>{{ s.quotaOverride === null ? 'Mengikuti kalender' : 'Kuota khusus slot' }}</small>
        <button class="primary" :disabled="!!busy">{{ busy === s.id ? 'Menyimpan…' : 'Simpan kuota' }}</button>
        <button v-if="s.quotaOverride !== null" type="button" :disabled="!!busy" @click="save(s, true)">Ikuti kalender</button>
      </form>
    </div>
  </section>
</template>
