<script setup lang="ts">
useHead({ title: 'Jadwalkan servis — Booking bengkel' })
interface Slot { id: string, startMinute: number, endMinute: number, remaining: number }
const request = useRequestFetch()
const { data: setup, error: setupError, refresh } = await useAsyncData('booking-setup', async () => {
  const [auth, catalog, profile] = await Promise.all([
    request<{ csrfToken: string }>('/api/customer/auth'),
    request<{ services: BookingService[], from: string, to: string }>('/api/customer/catalog'),
    request<{ customer: { name: string }, vehicles: BookingVehicle[] }>('/api/customer/profile'),
  ])
  return { auth, catalog, profile }
})
const step = ref(1), selectedServices = ref<string[]>([]), vehicleId = ref(''), complaint = ref(''), date = ref(setup.value?.catalog.from ?? ''), slotId = ref('')
const slots = ref<Slot[]>([]), slotsBusy = ref(false), slotsError = ref(''), error = ref(''), busy = ref(false), result = ref<CustomerBooking>()
const idempotencyKey = ref('')
const services = computed(() => setup.value?.catalog.services.filter(s => selectedServices.value.includes(s.id)) ?? [])
const total = computed(() => services.value.reduce((sum, s) => sum + s.price, 0))
const vehicle = computed(() => setup.value?.profile.vehicles.find(v => v.id === vehicleId.value))
const slot = computed(() => slots.value.find(s => s.id === slotId.value))
const canBook = computed(() => setup.value?.profile.customer.name && setup.value.profile.vehicles.length && setup.value.catalog.services.length)
watch([selectedServices, vehicleId, complaint, slotId], () => { idempotencyKey.value = '' }, { deep: true })
let slotRequest = 0
async function loadSlots() {
  const current = ++slotRequest
  slotsBusy.value = true; slotsError.value = ''; slots.value = []; slotId.value = ''
  try {
    const response = await $fetch<{ slots: Slot[] }>('/api/customer/slots', { query: { date: date.value } })
    if (current === slotRequest) slots.value = response.slots
  } catch (e) { if (current === slotRequest) slotsError.value = adminError(e) }
  finally { if (current === slotRequest) slotsBusy.value = false }
}
function next() {
  error.value = ''
  if (step.value === 1 && !services.value.length) { error.value = 'Pilih setidaknya satu layanan.'; return }
  if (step.value === 2 && (!vehicle.value || !complaint.value.trim())) { error.value = 'Pilih kendaraan dan isi keluhan.'; return }
  if (step.value === 3 && (!slot.value || slot.value.remaining < 1)) { error.value = 'Pilih slot yang masih tersedia.'; return }
  step.value++
  if (step.value === 3) void loadSlots()
}
async function submit() {
  if (busy.value || !setup.value) return
  busy.value = true; error.value = ''
  idempotencyKey.value ||= crypto.randomUUID()
  try {
    const response = await $fetch<{ booking: CustomerBooking }>('/api/customer/bookings', { method: 'POST', headers: { 'x-csrf-token': setup.value.auth.csrfToken }, body: {
      idempotencyKey: idempotencyKey.value, vehicleId: vehicleId.value, slotId: slotId.value, serviceIds: selectedServices.value, complaint: complaint.value,
    } })
    result.value = response.booking
  } catch (e) { error.value = adminError(e) }
  finally { busy.value = false }
}
</script>

<template>
  <main class="admin customer-account">
    <NuxtLink to="/bookings" class="back-link"><AppIcon name="arrow-right" />Booking saya</NuxtLink>
    <header class="page-heading"><h1>{{ result ? 'Booking tersimpan' : 'Jadwalkan servis' }}</h1><p>{{ result ? 'Simpan kode booking dan tunjukkan saat tiba di bengkel.' : 'Pilih kebutuhan kendaraan dan waktu kedatangan yang sesuai.' }}</p></header>
    <p v-if="setupError" role="alert" class="notice error">{{ adminError(setupError) }} <button @click="refresh()">Coba lagi</button></p>
    <BookingResult v-if="result" :booking="result" />
    <template v-else-if="setup">
      <div v-if="!canBook" class="empty-state"><AppIcon name="car" /><h2>Siapkan data untuk kunjungan Anda</h2><p>Lengkapi nama dan kendaraan sebelum booking. Jika layanan belum tersedia, hubungi bengkel.</p><NuxtLink to="/account" class="button">Lengkapi akun & kendaraan<AppIcon name="arrow-right" /></NuxtLink></div>
      <template v-else>
        <ol class="booking-stepper" aria-label="Langkah booking"><li v-for="(label, index) in ['Layanan', 'Kendaraan', 'Jadwal', 'Tinjau']" :key="label" :class="{ current: step === index + 1, complete: step > index + 1 }" :aria-current="step === index + 1 ? 'step' : undefined"><span class="step-index">{{ index + 1 }}</span>{{ label }}</li></ol>
        <p class="sr-only" aria-live="polite">Langkah {{ step }} dari 4</p>
        <p v-if="error" role="alert" class="notice error">{{ error }}</p>
        <div class="booking-workspace"><form class="panel" @submit.prevent="step === 4 ? submit() : next()">
          <fieldset :disabled="busy">
            <template v-if="step === 1">
              <legend>Pilih layanan</legend>
              <label v-for="s in setup.catalog.services" :key="s.id" class="check booking-service-option"><input v-model="selectedServices" type="checkbox" :value="s.id"><span>{{ s.name }}<small>{{ bookingMoney(s.price) }} · estimasi {{ s.durationMinutes }} menit</small></span></label>
              <p>Estimasi jasa: <strong>{{ bookingMoney(total) }}</strong></p>
            </template>
            <template v-if="step === 2">
              <legend>Kendaraan & keluhan</legend>
              <label>Kendaraan<select v-model="vehicleId" required><option disabled value="">Pilih kendaraan</option><option v-for="v in setup.profile.vehicles" :key="v.id" :value="v.id">{{ v.plate }} · {{ v.brand }} {{ v.model }}</option></select></label>
              <label>Keluhan atau kebutuhan servis<textarea v-model="complaint" required maxlength="2000" rows="5" placeholder="Ceritakan kondisi kendaraan Anda" /></label>
              <p><NuxtLink to="/account">Kelola kendaraan</NuxtLink></p>
            </template>
            <template v-if="step === 3">
              <legend>Pilih tanggal & slot</legend>
              <label>Tanggal (WIB)<input v-model="date" type="date" required :min="setup.catalog.from" :max="setup.catalog.to" @change="loadSlots"></label>
              <p class="muted">Online tersedia H+1 sampai H+14. Jam istirahat dan di luar jam buka tidak ditawarkan.</p>
              <p v-if="slotsBusy" role="status">Memuat ketersediaan…</p>
              <p v-else-if="slotsError" role="alert" class="notice error">{{ slotsError }} <button type="button" @click="loadSlots">Coba lagi</button></p>
              <p v-else-if="!slots.length" class="notice">Bengkel tutup / tidak ada slot operasional pada tanggal ini. Pilih tanggal lain.</p>
              <div class="booking-slot-grid"><label v-for="s in slots" :key="s.id" class="booking-slot" :class="{ full: !s.remaining, selected: slotId === s.id }"><input v-model="slotId" type="radio" name="slot" :value="s.id" :disabled="!s.remaining || slotsBusy"><span>{{ slotTime(s.startMinute) }}–{{ slotTime(s.endMinute) }}<small>{{ s.remaining ? `Tersisa ${s.remaining}` : 'Penuh / tidak tersedia' }}</small></span></label></div>
            </template>
            <template v-if="step === 4">
              <legend>Tinjau booking</legend>
              <p><strong>{{ vehicle?.plate }}</strong> · {{ vehicle?.brand }} {{ vehicle?.model }}</p>
              <p>{{ date }} · {{ slot ? slotTime(slot.startMinute) : '' }} WIB</p>
              <p class="booking-complaint">Keluhan: {{ complaint }}</p>
              <ul class="booking-service-list"><li v-for="s in services" :key="s.id">{{ s.name }} <strong>{{ bookingMoney(s.price) }}</strong></li></ul>
              <p>Estimasi jasa <strong>{{ bookingMoney(total) }}</strong></p>
              <p class="muted">Kuota dan layanan diperiksa lagi saat disimpan. Estimasi mengikuti tarif saat booking; biaya akhir mengikuti pekerjaan aktual. Konfirmasi dikirim melalui WhatsApp. Reminder H-1 pukul 16:00 WIB dilewati jika waktunya sudah lewat.</p>
            </template>
            <div class="actions section-actions"><button v-if="step > 1" type="button" @click="step--; error = ''">Kembali</button><button class="primary" :disabled="busy || (step === 3 && (slotsBusy || !slotId))">{{ busy ? 'Menyimpan…' : step === 4 ? 'Konfirmasi booking' : 'Lanjut' }}</button></div>
          </fieldset>
        </form>
        <aside class="booking-estimate" aria-labelledby="estimate-title"><h2 id="estimate-title">Rencana kunjungan</h2><p class="estimate-total">{{ bookingMoney(total) }}</p><p>Estimasi jasa yang dipilih</p><ul v-if="services.length"><li v-for="service in services" :key="service.id"><span>{{ service.name }}</span><strong>{{ bookingMoney(service.price) }}</strong></li></ul><p v-else>Pilih setidaknya satu layanan untuk memulai.</p><p v-if="vehicle"><strong>{{ vehicle.plate }}</strong><br>{{ vehicle.brand }} {{ vehicle.model }}</p><p v-if="slot">{{ date }}<br>{{ slotTime(slot.startMinute) }}–{{ slotTime(slot.endMinute) }} WIB</p><p class="estimate-note"><AppIcon name="shield-check" /><span>Pembayaran di bengkel. Biaya akhir mengikuti pekerjaan aktual.</span></p></aside>
        </div>
      </template>
    </template>
  </main>
</template>
