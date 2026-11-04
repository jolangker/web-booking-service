<script setup lang="ts">
import type { Calendar } from '@booking/core'
interface Conflict { slotId: string, date: string, startMinute: number, reserved: number, reason: string }
interface Preview { conflicts: Conflict[], slots: { date: string, startMinute: number, endMinute: number, quota: number }[], from: string, to: string }
const { request } = useAdmin()
const calendar = ref<Calendar>(), loading = ref(true), busy = ref(false), error = ref(''), message = ref(''), preview = ref<Preview>()
const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
const date = ref(''), closed = ref(true), quota = ref<number | null>(null), reason = ref('')
const previewDate = ref('')
const shownSlots = computed(() => preview.value?.slots.filter(s => s.date === previewDate.value) ?? [])
watch(calendar, () => { preview.value = undefined; message.value = '' }, { deep: true, flush: 'sync' })
async function load() {
  loading.value = true; error.value = ''
  try { calendar.value = await $fetch<Calendar>('/api/admin/calendar') }
  catch (e) { error.value = adminError(e) }
  finally { loading.value = false }
}
onMounted(load)
function addException() {
  if (!calendar.value) return
  if (calendar.value.exceptions.some(e => e.date === date.value)) { error.value = 'Tanggal sudah ada. Hapus baris lama untuk mengganti.'; return }
  calendar.value.exceptions.push({ date: date.value, closed: closed.value, quota: closed.value ? null : quota.value, reason: reason.value })
  calendar.value.exceptions.sort((a, b) => a.date.localeCompare(b.date))
  date.value = ''; reason.value = ''; quota.value = null; error.value = ''
}
async function check() {
  busy.value = true; error.value = ''; message.value = ''; preview.value = undefined
  try { preview.value = await request<Preview>('/api/admin/calendar/preview', 'POST', calendar.value); previewDate.value = preview.value.from }
  catch (e) { error.value = adminError(e) }
  finally { busy.value = false }
}
async function save() {
  busy.value = true; error.value = ''
  try {
    const result = await request<{ calendar: Calendar }>('/api/admin/calendar', 'PUT', calendar.value)
    calendar.value = result.calendar; message.value = 'Kalender dan slot tersimpan.'
  } catch (e) {
    error.value = adminError(e)
    const details = (e as { data?: { data?: { conflicts?: Conflict[] } } }).data?.data
    if (details?.conflicts && preview.value) preview.value.conflicts = details.conflicts
  } finally { busy.value = false }
}
const time = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
</script>

<template>
  <section aria-labelledby="calendar-title">
    <h2 id="calendar-title">Jam operasional & hari libur</h2>
    <p class="muted">Waktu WIB. Kosongkan jam buka untuk hari tutup. Slot utuh yang menyentuh istirahat tidak dibuat. Simpan setelah memeriksa preview.</p>
    <p v-if="error" role="alert" class="notice error">{{ error }} <button @click="load">Muat ulang kalender</button></p>
    <p v-if="message" role="status" class="notice success">{{ message }}</p>
    <p v-if="loading" role="status">Memuat kalender…</p>
    <template v-else-if="calendar">
      <form @submit.prevent="check">
        <fieldset :disabled="busy">
          <legend>Aturan mingguan</legend>
          <div class="form-row panel">
            <label>Durasi satu slot (menit)<input v-model.number="calendar.slotMinutes" type="number" required min="5" max="240" step="1"></label>
            <label>Kuota kedatangan per slot<input v-model.number="calendar.defaultQuota" type="number" required min="0" max="1000" step="1"></label>
          </div>
          <div class="week-grid">
            <div v-for="d in calendar.days" :key="d.day" class="panel day-panel">
              <h3>{{ days[d.day] }} <span v-if="!d.open.length" class="badge inactive">Tutup</span></h3>
              <p>Jam buka</p>
              <div v-for="(r, i) in d.open" :key="i" class="range-row">
                <label><span class="sr-only">{{ days[d.day] }} buka mulai {{ i + 1 }}</span><input v-model="r.start" type="time" required></label><span>–</span><label><span class="sr-only">{{ days[d.day] }} buka selesai {{ i + 1 }}</span><input v-model="r.end" type="time" required></label><button type="button" :aria-label="`Hapus jam buka ${days[d.day]} ${i + 1}`" @click="d.open.splice(i, 1)">Hapus</button>
              </div>
              <button type="button" @click="d.open.push({ start: '08:00', end: '17:00' })">Tambah jam buka</button>
              <p>Istirahat</p>
              <div v-for="(r, i) in d.breaks" :key="i" class="range-row">
                <label><span class="sr-only">{{ days[d.day] }} istirahat mulai {{ i + 1 }}</span><input v-model="r.start" type="time" required></label><span>–</span><label><span class="sr-only">{{ days[d.day] }} istirahat selesai {{ i + 1 }}</span><input v-model="r.end" type="time" required></label><button type="button" :aria-label="`Hapus istirahat ${days[d.day]} ${i + 1}`" @click="d.breaks.splice(i, 1)">Hapus</button>
              </div>
              <button type="button" @click="d.breaks.push({ start: '12:00', end: '13:00' })">Tambah istirahat</button>
            </div>
          </div>
        </fieldset>
        <div class="actions section-actions"><button class="primary" :disabled="busy">{{ busy ? 'Memproses…' : 'Periksa & preview perubahan' }}</button><button type="button" :disabled="busy || !preview || !!preview.conflicts.length" @click="save">Simpan kalender</button></div>
      </form>
      <div class="panel section-actions">
        <h3>Pengecualian tanggal</h3>
        <form class="form-row" @submit.prevent="addException">
          <label>Tanggal<input v-model="date" type="date" required :disabled="busy"></label>
          <label class="check"><input v-model="closed" type="checkbox" :disabled="busy">Libur / tutup</label>
          <label v-if="!closed">Kuota tanggal<input v-model.number="quota" required type="number" min="0" max="1000" step="1" :disabled="busy"></label>
          <label>Keterangan<input v-model="reason" maxlength="200" :disabled="busy"></label>
          <button :disabled="busy">Tambah pengecualian</button>
        </form>
        <p v-if="!calendar.exceptions.length" class="muted">Belum ada pengecualian tanggal.</p>
        <ul class="exception-list"><li v-for="(e, i) in calendar.exceptions" :key="e.date"><span>{{ e.date }} · {{ e.closed ? 'Libur' : `Kuota ${e.quota}` }} · {{ e.reason }}</span><button :disabled="busy" :aria-label="`Hapus pengecualian ${e.date}`" @click="calendar.exceptions.splice(i, 1)">Hapus</button></li></ul>
        <p class="muted">Pengecualian ikut disimpan dengan tombol Simpan kalender. Kuota khusus per slot tetap diprioritaskan.</p>
      </div>
      <div v-if="preview" class="panel section-actions" aria-live="polite">
        <h3>Preview perubahan · {{ preview.from }} s.d. {{ preview.to }}</h3>
        <div v-if="preview.conflicts.length" class="notice error"><p>Perubahan ditolak. Selesaikan reservasi yang konflik terlebih dahulu.</p><ul><li v-for="c in preview.conflicts" :key="c.slotId">{{ c.date }} {{ time(c.startMinute) }} · {{ c.reserved }} reservasi: {{ c.reason }}</li></ul></div>
        <p v-else>Tidak ditemukan konflik kapasitas. Periksa slot sebelum menyimpan perubahan.</p>
        <label>Tanggal preview<input v-model="previewDate" type="date" :min="preview.from" :max="preview.to"></label>
        <div class="slot-grid"><span v-for="s in shownSlots" :key="`${s.date}/${s.startMinute}`" class="slot-card">{{ time(s.startMinute) }}–{{ time(s.endMinute) }}<small>Kuota standar {{ s.quota }}</small></span></div>
        <p v-if="!shownSlots.length">Tidak ada slot untuk tanggal ini.</p>
      </div>
    </template>
  </section>
</template>
