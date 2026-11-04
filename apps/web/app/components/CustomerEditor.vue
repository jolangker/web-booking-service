<script setup lang="ts">
const props = defineProps<{ base: string, csrf: string, admin?: boolean }>()
const emit = defineEmits<{ saved: [] }>()
interface Vehicle { id: string, plate: string, brand: string, model: string, year: number, version: number }
const data = ref<{ customer: { id: string, name: string, phone: string, verifiedAt: string | null, version: number }, vehicles: Vehicle[] }>()
const name = ref(''), error = ref(''), notice = ref(''), busy = ref(false), showContact = ref(false)
const emptyVehicle = () => ({ id: '', plate: '', brand: '', model: '', year: new Date().getFullYear(), version: 1 })
const vehicle = ref(emptyVehicle())
const profilePath = computed(() => props.admin ? props.base : `${props.base}/profile`)
async function load() {
  try {
    data.value = await $fetch(profilePath.value)
    name.value = data.value!.customer.name
  } catch (e) { error.value = adminError(e) }
}
onMounted(load)
async function save(kind: 'profile' | 'vehicle') {
  if (!data.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const path = kind === 'profile' ? profilePath.value : `${props.base}/vehicles${vehicle.value.id ? `/${vehicle.value.id}` : ''}`
    await $fetch(path, { method: kind === 'profile' || vehicle.value.id ? 'PUT' : 'POST', headers: { 'x-csrf-token': props.csrf },
      body: kind === 'profile' ? { name: name.value, version: data.value.customer.version } : { ...vehicle.value } })
    if (kind === 'vehicle') vehicle.value = emptyVehicle()
    await load(); notice.value = 'Data tersimpan.'; emit('saved')
  } catch (e) { error.value = adminError(e) }
  finally { busy.value = false }
}
async function contactVerified() {
  showContact.value = false
  if (!props.admin) { await navigateTo('/login'); return }
  notice.value = 'Nomor baru terverifikasi. Sesi pelanggan telah dicabut.'
  await load(); emit('saved')
}
</script>

<template>
  <section class="panel">
    <h2>Profil pelanggan</h2>
    <p v-if="error" role="alert" class="notice error">{{ error }} <button :disabled="busy" @click="error = ''; load()">Muat ulang</button></p>
    <p v-if="notice" role="status" class="notice success">{{ notice }}</p>
    <template v-if="data">
      <p v-if="!data.customer.name" class="notice">Lengkapi nama Anda sebelum melanjutkan.</p>
      <form @submit.prevent="save('profile')">
        <label>Nama lengkap<input v-model="name" autocomplete="name" required maxlength="100"></label>
        <button type="submit" class="primary" :disabled="busy">Simpan profil</button>
      </form>
      <p>WhatsApp: {{ data.customer.phone }} · {{ data.customer.verifiedAt ? 'Terverifikasi' : 'Belum terverifikasi' }}</p>
      <button :disabled="busy" :aria-expanded="showContact" @click="showContact = !showContact">{{ showContact ? 'Tutup perubahan nomor' : 'Ubah nomor WhatsApp' }}</button>
      <OtpForm v-if="showContact" :base="`${base}/contact/otp`" :verify-path="`${base}/contact/verify`" :csrf="csrf" contact @verified="contactVerified" />
      <h2>Kendaraan ({{ data.vehicles.length }})</h2>
      <p v-if="!data.vehicles.length" class="muted">Belum ada kendaraan. Tambahkan kendaraan pertama.</p>
      <ul class="vehicle-list">
        <li v-for="item in data.vehicles" :key="item.id">
          <div><strong>{{ item.plate }}</strong><p>{{ item.brand }} {{ item.model }} · {{ item.year }}</p></div>
          <button :disabled="busy" :aria-label="`Edit kendaraan ${item.plate}`" @click="vehicle = { ...item }">Edit</button>
        </li>
      </ul>
      <h3>{{ vehicle.id ? `Edit ${vehicle.plate}` : 'Tambah kendaraan' }}</h3>
      <form @submit.prevent="save('vehicle')">
        <fieldset :disabled="busy">
          <div class="form-row">
            <label>Plat nomor<input v-model="vehicle.plate" required maxlength="15" placeholder="B 1234 ABC"></label>
            <label>Merek<input v-model="vehicle.brand" required maxlength="60" placeholder="Honda"></label>
          </div>
          <div class="form-row section-actions">
            <label>Tipe/model<input v-model="vehicle.model" required maxlength="80" placeholder="Vario 160"></label>
            <label>Tahun<input v-model.number="vehicle.year" type="number" required min="1900" :max="new Date().getFullYear() + 1"></label>
          </div>
          <div class="actions section-actions"><button type="submit" class="primary">{{ vehicle.id ? 'Simpan kendaraan' : 'Tambah kendaraan' }}</button><button v-if="vehicle.id" type="button" @click="vehicle = emptyVehicle()">Batal edit</button></div>
        </fieldset>
      </form>
    </template>
    <p v-else-if="!error" role="status">Memuat profil…</p>
  </section>
</template>
