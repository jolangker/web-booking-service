<script setup lang="ts">
interface Dashboard { date: string, bookings: ReceptionBooking[], carryover: Pick<ReceptionBooking, 'id' | 'code' | 'status' | 'scheduledAt' | 'vehicle' | 'workOrderId'>[], slots: ReceptionSlot[], summary: { vehicles: number, waiting: number, received: number, remaining: number }, searched: boolean }
const dashboard = ref<Dashboard>(), query = ref(''), selected = ref<ReceptionBooking>(), notice = ref(''), loading = ref(false), loadError = ref(''), walkIn = ref(false)
const physical = ref<ReceptionPhysical>({ odometer: '', initialCondition: '', pit: '', assignee: '' })
const { pending, busy, error, submit } = useReceptionSubmit('reception-check-in', received)
async function load() {
  loading.value = true; loadError.value = ''
  try {
    dashboard.value = await $fetch<Dashboard>('/api/admin/reception', { query: query.value.trim() ? { q: query.value } : {} })
    if (selected.value) {
      const fresh = dashboard.value.bookings.find(b => b.id === selected.value?.id)
      if (!fresh || fresh.version !== selected.value.version) selected.value = undefined
    }
  } catch (e) { loadError.value = adminError(e) }
  finally { loading.value = false }
}
function choose(booking: ReceptionBooking) {
  selected.value = booking; error.value = ''; notice.value = ''
  physical.value = { odometer: booking.odometer ?? '', initialCondition: booking.initialCondition ?? '', pit: booking.pit ?? '', assignee: booking.assignee ?? '' }
}
function received(result: ReceptionResult) {
  notice.value = `Kendaraan Diterima · ${result.workOrder.code}. WO tersimpan${result.replayed ? ' (hasil submit sebelumnya)' : ''}.`
  selected.value = undefined; walkIn.value = false; void load()
}
async function checkIn() {
  if (!selected.value) return
  await submit(`/api/admin/reception/${selected.value.id}/check-in`, { ...physical.value, version: selected.value.version })
  if (error.value && !pending.value) { selected.value = undefined; await load() }
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { void load(); timer = setInterval(() => { if (!document.hidden && !selected.value && !walkIn.value && !busy.value && !loading.value) void load() }, 30000) })
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <section class="reception">
    <div class="admin-header"><h2>Penerimaan kendaraan</h2><div class="actions"><button :disabled="busy || loading" data-refresh-reception @click="load">Perbarui antrean</button><button :disabled="busy || Boolean(pending)" data-open-walk-in @click="walkIn = !walkIn">{{ walkIn ? 'Tutup walk-in' : 'Daftarkan walk-in' }}</button></div></div>
    <p class="muted">Tanggal bengkel {{ dashboard?.date }} · WIB. Check-in pada hari jadwal selama jam operasional; datang lebih awal/terlambat pada hari yang sama boleh. No-show tidak melepas kuota otomatis.</p>
    <p v-if="notice" class="notice success" role="status" data-reception-success>{{ notice }}</p>
    <p v-if="loadError || error" class="notice error" role="alert">{{ loadError || error }}</p>
    <div v-if="pending" class="notice" role="status"><p>Submit sebelumnya belum dipastikan. Pulihkan hasil dengan data yang sama.</p><button :disabled="busy" data-retry-check-in @click="submit()">Coba lagi check-in tertunda</button></div>
    <div v-if="dashboard" class="reception-summary" aria-label="Ringkasan hari ini">
      <p><strong>{{ dashboard.summary.vehicles }}</strong> kendaraan</p><p><strong>{{ dashboard.summary.waiting }}</strong> menunggu</p><p><strong>{{ dashboard.summary.received }}</strong> diterima</p><p><strong>{{ dashboard.summary.remaining }}</strong> sisa kuota slot belum berakhir</p>
    </div>
    <form class="panel" @submit.prevent="selected = undefined; load()"><label>Kode booking, plat, atau hasil scan QR<input v-model="query" name="receptionLookup" maxlength="40" autocomplete="off" placeholder="BK-YYYYMMDD-NNN / B1234ABC"></label><p class="muted">Scan dengan pembaca QR mode keyboard, atau tempel hasil scan dari ponsel. QR harus berisi kode booking saja. Pilih booking yang sesuai jika plat memiliki beberapa hasil.</p><div class="actions"><button type="submit" :disabled="busy || loading" data-search-reception>Cari booking / QR</button><button type="button" :disabled="busy || loading" @click="query = ''; selected = undefined; load()">Antrean hari ini</button></div></form>
    <p v-if="loading" role="status">Memuat antrean…</p>
    <div v-if="dashboard" class="admin-columns section-actions">
      <section class="panel"><h3>{{ dashboard.searched ? 'Hasil pencarian — pilih konteks booking' : 'Antrean aktif hari ini' }}</h3>
        <p v-if="!dashboard.bookings.length">Tidak ada booking yang sesuai.</p>
        <ul class="customer-list"><li v-for="b in dashboard.bookings" :key="b.id"><button :data-booking-id="b.id" :aria-current="selected?.id === b.id ? 'true' : undefined" :disabled="busy || Boolean(pending)" @click="choose(b)"><strong>{{ b.vehicle.plate }} · {{ b.code }}</strong><br>{{ b.customerName }}<br><small>{{ bookingTime(b.scheduledAt) }}<br>{{ bookingStatus(b.status, b.reservationStatus) }}</small></button></li></ul>
      </section>
      <section v-if="selected" class="panel reception-check-in">
        <h3>{{ selected.code }} · {{ selected.vehicle.plate }}</h3><p>{{ selected.customerName }} · {{ selected.phone }}</p><p>{{ selected.vehicle.brand }} {{ selected.vehicle.model }} · {{ selected.vehicle.year }}</p><p>{{ bookingTime(selected.scheduledAt) }}</p><p class="booking-complaint">Keluhan: {{ selected.complaint }}</p><ul><li v-for="s in selected.services" :key="s.name">{{ s.name }} · {{ bookingMoney(s.price) }}</li></ul>
        <template v-if="selected.workOrderId"><h4>Kendaraan Diterima</h4><p>{{ selected.receivedAt ? bookingTime(selected.receivedAt) : '' }}</p><p>Odometer: {{ selected.odometer }} km</p><p class="booking-complaint">{{ selected.initialCondition }}</p><p>Pit: {{ selected.pit || 'Belum ditentukan' }} · Pelaksana: {{ selected.assignee || 'Belum ditentukan' }}</p></template>
        <form v-else-if="selected.status === 'confirmed' && selected.reservationStatus === 'active' && new Date(selected.scheduledAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }) === dashboard.date" @submit.prevent="checkIn">
          <fieldset :disabled="busy || Boolean(pending)"><ReceptionFields v-model="physical" /><button class="primary section-actions" type="submit" data-submit-check-in>{{ busy ? 'Menyimpan…' : 'Terima kendaraan & buat WO' }}</button></fieldset>
        </form>
        <p v-else role="status">Booking ini tidak dapat diterima. Booking harus aktif pada tanggal hari ini; kunjungan hari lain memakai walk-in.</p>
      </section>
      <p v-else class="muted">Pilih booking untuk memeriksa identitas, layanan, dan kondisi kendaraan.</p>
    </div>
    <AdminWalkIn v-if="walkIn && dashboard" :slots="dashboard.slots" class="section-actions" @received="received" />
    <section v-if="dashboard?.carryover.length" class="panel section-actions"><h3>Kendaraan lintas hari</h3><ul><li v-for="b in dashboard.carryover" :key="b.id"><button @click="query = b.code; load()">{{ b.code }} · {{ b.vehicle.plate }}</button> · {{ bookingStatus(b.status) }} · {{ bookingTime(b.scheduledAt) }}</li></ul><p class="muted">Sudah diterima pada kunjungan sebelumnya. Tidak memesan kuota hari ini lagi.</p></section>
  </section>
</template>
