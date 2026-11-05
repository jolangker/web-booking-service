<script setup lang="ts">
defineProps<{ slots: ReceptionSlot[] }>()
const emit = defineEmits<{ received: [result: ReceptionResult] }>()
const { pending, busy, error, submit } = useReceptionSubmit('reception-walk-in', result => emit('received', result))
const newCustomer = ref(false), newVehicle = ref(false), query = ref(''), customerId = ref(''), vehicleId = ref('')
const customers = ref<{ id: string, name: string, phone: string }[]>([]), vehicles = ref<BookingVehicle[]>([]), services = ref<BookingService[]>([])
const customer = reactive({ name: '', phone: '' }), vehicle = reactive({ plate: '', brand: '', model: '', year: new Date().getFullYear() })
const slotId = ref(''), serviceIds = ref<string[]>([]), complaint = ref('')
const physical = ref<ReceptionPhysical>({ odometer: '', initialCondition: '', pit: '', assignee: '' })
const loading = ref(false)
async function findCustomers() {
  loading.value = true
  try { customers.value = (await $fetch<{ customers: typeof customers.value }>('/api/admin/customers', { query: { q: query.value } })).customers }
  catch (e) { error.value = adminError(e) }
  finally { loading.value = false }
}
async function loadVehicles() {
  vehicleId.value = ''; vehicles.value = []
  if (!customerId.value) return
  loading.value = true
  try { vehicles.value = (await $fetch<{ vehicles: BookingVehicle[] }>(`/api/admin/customers/${customerId.value}`)).vehicles }
  catch (e) { error.value = adminError(e) }
  finally { loading.value = false }
}
watch(newCustomer, value => { customerId.value = ''; vehicleId.value = ''; vehicles.value = []; newVehicle.value = value })
watch(customerId, loadVehicles)
onMounted(async () => {
  await findCustomers()
  try { services.value = (await $fetch<{ services: (BookingService & { active: boolean })[] }>('/api/admin/services')).services.filter(s => s.active) }
  catch (e) { error.value = adminError(e) }
})
async function save() {
  await submit('/api/admin/reception/walk-in', { ...physical.value, slotId: slotId.value, serviceIds: serviceIds.value, complaint: complaint.value,
    ...(newCustomer.value ? { customer: { ...customer } } : { customerId: customerId.value }),
    ...(newVehicle.value ? { vehicle: { ...vehicle } } : { vehicleId: vehicleId.value }) })
}
</script>

<template>
  <section class="panel reception-walk-in">
    <h3>Terima pelanggan walk-in</h3>
    <p class="muted">Cari profil existing lebih dahulu. Pendaftaran baru tidak memverifikasi WhatsApp atau membuat sesi pelanggan. Pastikan nomor penerima bersama pelanggan.</p>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <div v-if="pending" class="notice" role="status"><p>Submit sebelumnya belum dipastikan. Periksa dan pulihkan hasil sebelum membuat penerimaan lain.</p><button :disabled="busy" data-retry-walk-in @click="submit()">Coba lagi penerimaan tertunda</button></div>
    <form @submit.prevent="save">
      <fieldset :disabled="busy || Boolean(pending)">
        <label class="check"><input v-model="newCustomer" name="newCustomer" type="checkbox">Pelanggan baru</label>
        <template v-if="newCustomer">
          <label>Nama pelanggan<input v-model="customer.name" name="customerName" required maxlength="100"></label>
          <label>WhatsApp<input v-model="customer.phone" name="customerPhone" type="tel" required maxlength="30" placeholder="08… atau +628…"></label>
        </template>
        <template v-else>
          <div class="form-row"><label>Cari pelanggan<input v-model="query" name="customerSearch" maxlength="100" @keydown.enter.prevent="findCustomers"></label><button type="button" :disabled="loading" @click="findCustomers">Cari pelanggan</button></div>
          <label>Pelanggan<select v-model="customerId" name="customerId" required><option disabled value="">Pilih pelanggan</option><option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name || 'Nama belum diisi' }} · {{ c.phone }}</option></select></label>
        </template>
        <label v-if="!newCustomer" class="check"><input v-model="newVehicle" name="newVehicle" type="checkbox">Kendaraan baru untuk pelanggan ini</label>
        <template v-if="newVehicle">
          <label>Plat<input v-model="vehicle.plate" name="plate" required maxlength="15"></label>
          <div class="form-row"><label>Merek<input v-model="vehicle.brand" name="brand" required maxlength="60"></label><label>Tipe/model<input v-model="vehicle.model" name="model" required maxlength="80"></label><label>Tahun<input v-model.number="vehicle.year" name="year" type="number" required min="1900" :max="new Date().getFullYear() + 1"></label></div>
        </template>
        <label v-else>Kendaraan<select v-model="vehicleId" name="vehicleId" required :disabled="loading"><option disabled value="">Pilih kendaraan</option><option v-for="v in vehicles" :key="v.id" :value="v.id">{{ v.plate }} · {{ v.brand }} {{ v.model }}</option></select></label>
        <label>Slot hari ini<select v-model="slotId" name="walkInSlot" required><option disabled value="">Pilih slot tersedia</option><option v-for="s in slots" :key="s.id" :value="s.id" :disabled="!s.canWalkIn || s.remaining < 1">{{ slotTime(s.startMinute) }}–{{ slotTime(s.endMinute) }} · Sisa {{ s.remaining }}{{ s.canWalkIn ? '' : ' · Lewat' }}</option></select></label>
        <fieldset><legend>Layanan</legend><label v-for="s in services" :key="s.id" class="check"><input v-model="serviceIds" type="checkbox" name="walkInService" :value="s.id">{{ s.name }} · {{ bookingMoney(s.price) }}</label><p v-if="!services.length">Belum ada layanan aktif. Atur layanan terlebih dahulu.</p></fieldset>
        <label>Keluhan<textarea v-model="complaint" name="complaint" required maxlength="2000" rows="3" /></label>
        <ReceptionFields v-model="physical" />
        <button class="primary section-actions" type="submit" data-submit-walk-in :disabled="loading || !serviceIds.length">{{ busy ? 'Menyimpan…' : 'Reservasi & terima walk-in' }}</button>
      </fieldset>
    </form>
  </section>
</template>
