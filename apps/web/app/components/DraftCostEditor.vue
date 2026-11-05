<script setup lang="ts">
export interface CostLine { kind: 'service' | 'part', serviceId: string | null, description: string, quantity: number, unitPrice: number }
const lines = defineModel<CostLine[]>({ required: true })
const props = defineProps<{ services: { id: string, name: string, price: number }[] }>()
const chosen = ref('')
function addService() {
  const service = props.services.find(s => s.id === chosen.value)
  if (!service || lines.value.some(l => l.serviceId === service.id)) return
  lines.value.push({ kind: 'service', serviceId: service.id, description: service.name, quantity: 1, unitPrice: service.price }); chosen.value = ''
}
const preview = computed(() => lines.value.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice), 0))
</script>

<template>
  <section class="section-actions">
    <h4>Draft rincian biaya</h4><p class="muted">Masukkan rupiah tanpa pecahan. Harga jasa awal mengikuti harga saat booking. Koreksi sebelum pembayaran disimpan dalam riwayat perubahan.</p>
    <div v-for="(line, i) in lines" :key="i" class="cost-line panel">
      <strong>{{ line.kind === 'service' ? 'Jasa' : 'Part aktual' }} {{ i + 1 }}</strong>
      <label>Deskripsi<input v-model="line.description" :aria-label="`Deskripsi baris ${i + 1}`" :readonly="line.kind === 'service'" required maxlength="200"></label>
      <div class="form-row"><label>Jumlah<input v-model.number="line.quantity" :aria-label="`Jumlah baris ${i + 1}`" type="number" min="1" max="999" step="1" required></label><label>Harga satuan (Rp)<input v-model.number="line.unitPrice" :aria-label="`Harga baris ${i + 1}`" type="number" min="0" max="2147483647" step="1" required></label></div>
      <div class="actions section-actions"><span>{{ bookingMoney(Number(line.quantity) * Number(line.unitPrice)) }}</span><button type="button" :aria-label="`Hapus baris ${i + 1}`" @click="lines.splice(i, 1)">Hapus</button></div>
    </div>
    <div class="form-row section-actions"><label>Tambah jasa<select v-model="chosen"><option value="">Pilih layanan</option><option v-for="s in services.filter(s => !lines.some(l => l.serviceId === s.id))" :key="s.id" :value="s.id">{{ s.name }} · {{ bookingMoney(s.price) }}</option></select></label><button type="button" :disabled="!chosen || lines.length >= 100" @click="addService">Tambah jasa</button><button type="button" data-add-part :disabled="lines.length >= 100" @click="lines.push({ kind: 'part', serviceId: null, description: '', quantity: 1, unitPrice: 0 })">Tambah part manual</button></div>
    <p>Pratinjau belum disimpan: <strong>{{ bookingMoney(preview) }}</strong></p>
  </section>
</template>
