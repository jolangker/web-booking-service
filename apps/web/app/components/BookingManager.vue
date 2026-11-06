<script setup lang="ts">
interface Slot { id: string, startMinute: number, endMinute: number, remaining: number }
const props = defineProps<{ booking: CustomerBooking }>()
const emit = defineEmits<{ updated: [booking: CustomerBooking], refresh: [] }>()
const route = useRoute()
const action = ref<'reschedule' | 'cancel' | ''>(''), review = ref(false), busy = ref(false), error = ref(''), success = ref('')
const catalog = ref<{ from: string, to: string }>(), date = ref(''), slots = ref<Slot[]>([]), slotId = ref(''), slotsBusy = ref(false), slotsError = ref('')
const slot = computed(() => slots.value.find(s => s.id === slotId.value))
let expectedVersion = 0, idempotencyKey = '', slotRequest = 0
watch(slotId, () => { idempotencyKey = ''; review.value = false })
watch(() => props.booking.version, () => {
  if (!action.value) return
  action.value = ''; review.value = false; idempotencyKey = ''
  error.value = 'Booking telah berubah. Periksa jadwal terbaru sebelum melanjutkan.'
})
async function loadSlots() {
  const current = ++slotRequest
  slotsBusy.value = true; slotsError.value = ''; slots.value = []; slotId.value = ''; review.value = false
  try {
    const result = await $fetch<{ slots: Slot[] }>('/api/customer/slots', { query: { date: date.value } })
    if (current === slotRequest) slots.value = result.slots
  } catch (e) { if (current === slotRequest) slotsError.value = adminError(e) }
  finally { if (current === slotRequest) slotsBusy.value = false }
}
async function begin(next: 'reschedule' | 'cancel') {
  action.value = next; review.value = next === 'cancel'; error.value = ''; success.value = ''; idempotencyKey = ''; expectedVersion = props.booking.version
  if (next === 'reschedule') {
    busy.value = true; catalog.value = undefined
    try {
      catalog.value = await $fetch('/api/customer/catalog')
      date.value = catalog.value!.from
      await loadSlots()
    } catch (e) { error.value = adminError(e) }
    finally { busy.value = false }
  }
}
async function submit() {
  if (busy.value || !action.value) return
  if (action.value === 'reschedule' && (!slot.value || slot.value.remaining < 1)) return
  busy.value = true; error.value = ''; idempotencyKey ||= crypto.randomUUID()
  try {
    const auth = await $fetch<{ csrfToken: string }>('/api/customer/auth')
    const result = await $fetch<{ booking: CustomerBooking }>(`/api/customer/bookings/${props.booking.id}/${action.value}`, {
      method: 'POST', headers: { 'x-csrf-token': auth.csrfToken },
      body: { version: expectedVersion, idempotencyKey, ...(action.value === 'reschedule' ? { slotId: slotId.value } : {}) },
    })
    success.value = action.value === 'cancel' ? 'Reservasi berhasil dibatalkan.' : 'Jadwal berhasil diperbarui. Kode booking dan QR tetap berlaku.'
    action.value = ''; emit('updated', result.booking)
    await refreshNuxtData('my-bookings')
  } catch (e) {
    error.value = adminError(e)
    if ((e as { statusCode?: number }).statusCode === 409) emit('refresh')
  } finally { busy.value = false }
}
onMounted(() => {
  if (props.booking.canManage && (route.query.action === 'reschedule' || route.query.action === 'cancel')) void begin(route.query.action)
})
</script>

<template>
  <section class="panel section-actions booking-manager" aria-labelledby="manage-booking-title">
    <h2 id="manage-booking-title">Kelola booking</h2>
    <p v-if="success" class="notice" role="status">{{ success }}</p>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="booking.canManage">Ubah atau batal paling lambat 120 menit sebelum jadwal aktif. Ketersediaan dan batas waktu diperiksa kembali saat disimpan.</p>
    <p v-else class="muted">{{ booking.reservationStatus === 'cancelled' ? 'Reservasi sudah dibatalkan.' : 'Ubah/batal tidak tersedia setelah batas 120 menit atau kendaraan diterima bengkel.' }}</p>
    <div v-if="!action && booking.canManage" class="actions"><button data-action="reschedule" @click="begin('reschedule')">Ubah jadwal</button><button data-action="cancel" @click="begin('cancel')">Batalkan reservasi</button></div>
    <form v-if="action" @submit.prevent="review ? submit() : review = true">
      <fieldset :disabled="busy">
        <legend>{{ action === 'cancel' ? 'Konfirmasi pembatalan' : review ? 'Konfirmasi jadwal baru' : 'Pilih jadwal baru' }}</legend>
        <p>Booking <strong>{{ booking.code }}</strong> · jadwal aktif {{ bookingTime(booking.scheduledAt) }}</p>
        <template v-if="action === 'reschedule' && !review">
          <label v-if="catalog">Tanggal (WIB)<input v-model="date" type="date" required :min="catalog.from" :max="catalog.to" @change="loadSlots"></label>
          <p v-if="busy || slotsBusy" role="status">Memuat ketersediaan…</p>
          <p v-else-if="slotsError" class="notice error" role="alert">{{ slotsError }} <button type="button" @click="loadSlots">Coba lagi</button></p>
          <p v-else-if="catalog && !slots.length" class="notice">Bengkel tutup / tidak ada slot operasional. Pilih tanggal lain.</p>
          <div class="booking-slot-grid"><label v-for="s in slots" :key="s.id" class="booking-slot" :class="{ full: !s.remaining, selected: slotId === s.id }"><input v-model="slotId" type="radio" name="reschedule-slot" :value="s.id" :disabled="!s.remaining || slotsBusy || s.id === booking.slotId"><span>{{ slotTime(s.startMinute) }}–{{ slotTime(s.endMinute) }}<small>{{ s.id === booking.slotId ? 'Jadwal aktif' : s.remaining ? `Tersisa ${s.remaining}` : 'Penuh / tidak tersedia' }}</small></span></label></div>
        </template>
        <template v-if="review">
          <p v-if="action === 'cancel'">Batalkan reservasi ini? Kuota akan dilepas dan reminder dihentikan. Untuk datang kembali, buat booking baru.</p>
          <p v-else>Jadwal baru: <strong>{{ date }} · {{ slot ? slotTime(slot.startMinute) : '' }} WIB</strong>. Kode booking, QR dan estimasi tetap.</p>
        </template>
        <div class="actions section-actions"><button type="button" @click="action = ''; error = ''; slotRequest++">Tutup</button><button v-if="review && action === 'reschedule'" type="button" @click="review = false">Pilih ulang</button><button class="primary" :disabled="busy || (action === 'reschedule' && (slotsBusy || !slotId))">{{ busy ? 'Menyimpan…' : !review ? 'Tinjau perubahan' : action === 'cancel' ? 'Ya, batalkan reservasi' : 'Simpan jadwal baru' }}</button></div>
      </fieldset>
    </form>
  </section>
</template>
