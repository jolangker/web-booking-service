<script setup lang="ts">
const { csrf, request } = useAdmin()
const search = ref(''), name = ref(''), phone = ref(''), selected = ref(''), error = ref(''), busy = ref(false)
const customers = ref<{ id: string, name: string, phone: string, verifiedAt: string | null }[]>([])
async function load() {
  error.value = ''
  try { customers.value = (await $fetch<{ customers: typeof customers.value }>('/api/admin/customers', { query: { q: search.value } })).customers }
  catch (e) { error.value = adminError(e) }
}
onMounted(load)
async function create() {
  busy.value = true; error.value = ''
  try {
    const result = await request<{ id: string }>('/api/admin/customers', 'POST', { name: name.value, phone: phone.value })
    selected.value = result.id; name.value = ''; phone.value = ''; search.value = ''; await load()
  } catch (e) { error.value = adminError(e) }
  finally { busy.value = false }
}
</script>

<template>
  <section>
    <h2>Pelanggan & kendaraan</h2>
    <p class="muted">Cari data yang sudah ada sebelum mendaftarkan pelanggan. Pendaftaran oleh Admin tidak membuat sesi pelanggan.</p>
    <p v-if="error" role="alert" class="notice error">{{ error }}</p>
    <div class="admin-columns">
      <div class="panel">
        <form @submit.prevent="load"><label>Cari nama, WhatsApp, atau plat<input v-model="search" maxlength="100"></label><button type="submit" :disabled="busy">Cari pelanggan</button></form>
        <p v-if="!customers.length">Pelanggan tidak ditemukan.</p>
        <ul class="customer-list"><li v-for="item in customers" :key="item.id"><button :aria-current="selected === item.id ? 'true' : undefined" @click="selected = item.id">{{ item.name || 'Nama belum diisi' }}<br><small>{{ item.phone }} · {{ item.verifiedAt ? 'Terverifikasi' : 'Belum verifikasi' }}</small></button></li></ul>
        <h3>Daftarkan pelanggan</h3>
        <form @submit.prevent="create"><label>Nama<input v-model="name" required maxlength="100"></label><label>WhatsApp<input v-model="phone" type="tel" required maxlength="30" placeholder="08… atau +628…"></label><button type="submit" :disabled="busy">Daftarkan</button></form>
      </div>
      <CustomerEditor v-if="selected" :key="selected" :base="`/api/admin/customers/${selected}`" :csrf="csrf" admin @saved="load" />
      <p v-else>Pilih pelanggan untuk mengelola profil dan kendaraannya.</p>
    </div>
  </section>
</template>
