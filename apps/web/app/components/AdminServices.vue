<script setup lang="ts">
interface Service { id: string, name: string, price: number, durationMinutes: number, active: boolean, version: number }
const { request } = useAdmin()
const services = ref<Service[]>([]), loading = ref(true), busy = ref(false), error = ref(''), message = ref('')
const blank = () => ({ name: '', price: 0, durationMinutes: 60, active: true })
const form = ref<ReturnType<typeof blank> & { id?: string, version?: number }>(blank())
async function load() {
  loading.value = true; error.value = ''
  try { services.value = (await $fetch<{ services: Service[] }>('/api/admin/services')).services }
  catch (e) { error.value = adminError(e) }
  finally { loading.value = false }
}
onMounted(load)
async function save() {
  busy.value = true; error.value = ''; message.value = ''
  try {
    await request(`/api/admin/services${form.value.id ? `/${form.value.id}` : ''}`, form.value.id ? 'PUT' : 'POST', form.value)
    form.value = blank(); await load(); message.value = 'Layanan tersimpan.'
  } catch (e) { error.value = adminError(e) }
  finally { busy.value = false }
}
const rupiah = (price: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(price)
</script>

<template>
  <section aria-labelledby="services-title">
    <h2 id="services-title">Master layanan</h2>
    <p class="muted">Perubahan berlaku untuk master. Nonaktifkan layanan untuk menghentikan pilihan baru dan mempertahankan referensi historis.</p>
    <p v-if="error" role="alert" class="notice error">{{ error }} <button @click="load">Muat ulang daftar</button></p>
    <p v-if="message" role="status" class="notice success">{{ message }}</p>
    <div class="admin-columns">
      <form class="panel" @submit.prevent="save">
        <h3>{{ form.id ? 'Ubah layanan' : 'Tambah layanan' }}</h3>
        <label>Nama layanan<input v-model="form.name" required maxlength="100" placeholder="Contoh: Servis berkala"></label>
        <label>Tarif standar (Rp)<input v-model.number="form.price" required type="number" min="0" max="2147483647" step="1"></label>
        <label>Estimasi durasi (menit)<input v-model.number="form.durationMinutes" required type="number" min="1" max="1440" step="1"></label>
        <label class="check"><input v-model="form.active" type="checkbox">Aktif untuk booking baru</label>
        <div class="actions"><button class="primary" :disabled="busy">{{ busy ? 'Menyimpan…' : 'Simpan layanan' }}</button><button v-if="form.id" type="button" :disabled="busy" @click="form = blank()">Batal edit</button></div>
      </form>
      <div class="panel">
        <p v-if="loading" role="status">Memuat layanan…</p>
        <p v-else-if="!services.length">Belum ada layanan. Tambahkan layanan pertama melalui formulir.</p>
        <div v-else class="table-scroll">
          <table><caption class="sr-only">Daftar layanan bengkel</caption><thead><tr><th>Layanan</th><th>Tarif</th><th>Durasi</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
            <tr v-for="s in services" :key="s.id"><td>{{ s.name }}</td><td>{{ rupiah(s.price) }}</td><td>{{ s.durationMinutes }} menit</td><td><span class="badge" :class="{ inactive: !s.active }">{{ s.active ? 'Aktif' : 'Nonaktif' }}</span></td><td><button :aria-label="`Ubah ${s.name}`" :disabled="busy" @click="form = { ...s }; message = ''">Ubah</button></td></tr>
          </tbody></table>
        </div>
      </div>
    </div>
  </section>
</template>
