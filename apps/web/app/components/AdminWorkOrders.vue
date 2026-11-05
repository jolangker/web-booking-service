<script setup lang="ts">
import type { CostLine } from './DraftCostEditor.vue'
interface WorkOrder { id: string, bookingId: string, version: number, code: string, status: string, odometer: number, initialCondition: string, pit: string, assignee: string, diagnosis: string, inspection: string, notes: string, complaint: string, vehicle: { plate: string }, customerName: string, phone: string }
interface Detail { workOrder: WorkOrder, draft: { lines: CostLine[], serviceSubtotal: number, partSubtotal: number, total: number }, history: { version: number, status: string, occurredAt: string, estimate: { total: number } | null }[], changes: { version: number, action: string, actorId: string, reason: string, before: unknown, after: unknown, occurredAt: string }[], tracking: { url: string | null, expiresAt: string, revokedAt: string | null }, replayed?: boolean }
const { request } = useAdmin()
const orders = ref<{ id: string, code: string, status: string, vehicle: { plate: string }, pit: string, assignee: string }[]>([]), services = ref<{ id: string, name: string, price: number }[]>([])
const detail = ref<Detail>(), fields = ref<WorkOrder>(), lines = ref<CostLine[]>([]), reason = ref(''), error = ref(''), notice = ref(''), busy = ref(false), form = ref<HTMLFormElement>()
const pending = ref<{ url: string, body: Record<string, unknown> }>()
const storageKey = 'work-order-mutation'
function show(data: Detail) { detail.value = data; fields.value = { ...data.workOrder }; lines.value = data.draft.lines.map(l => ({ ...l })); reason.value = '' }
async function load() {
  try {
    const [list, catalog] = await Promise.all([$fetch<{ workOrders: typeof orders.value }>('/api/admin/work-orders'), $fetch<{ services: typeof services.value }>('/api/admin/services')])
    orders.value = list.workOrders; services.value = catalog.services.filter(s => (s as { active?: boolean }).active)
  } catch (e) { error.value = adminError(e) }
}
async function open(id: string) {
  if (busy.value || pending.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { show(await $fetch<Detail>(`/api/admin/work-orders/${id}`)) }
  catch (e) { error.value = adminError(e) }
  finally { busy.value = false }
}
async function mutate(action = 'save') {
  if (busy.value) return
  if (!pending.value) {
    if (!fields.value) return
    if (action.endsWith('_tracking')) {
      if (!reason.value.trim()) { error.value = 'Isi alasan perubahan tautan terlebih dahulu.'; return }
    } else if (!form.value?.reportValidity()) return
    const w = fields.value
    pending.value = { url: `/api/admin/work-orders/${w.bookingId}`, body: { action, version: w.version, expectedStatus: w.status, idempotencyKey: crypto.randomUUID(), reason: reason.value,
      odometer: w.odometer, initialCondition: w.initialCondition, pit: w.pit, assignee: w.assignee, diagnosis: w.diagnosis, inspection: w.inspection, notes: w.notes, lines: lines.value.map(l => ({ ...l })) } }
    sessionStorage.setItem(storageKey, JSON.stringify(pending.value))
  }
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const result = await request<Detail>(pending.value.url, 'POST', pending.value.body)
    pending.value = undefined; sessionStorage.removeItem(storageKey); show(result)
    notice.value = `WO tersimpan · ${bookingStatus(result.workOrder.status)}${result.replayed ? ' (hasil submit sebelumnya)' : ''}. Pembayaran belum lunas.`
    await load()
  } catch (e) {
    error.value = adminError(e)
    const status = (e as { statusCode?: number }).statusCode
    if (status && status >= 400 && status < 500) { pending.value = undefined; sessionStorage.removeItem(storageKey) }
  } finally { busy.value = false }
}
onMounted(() => {
  const stored = sessionStorage.getItem(storageKey)
  if (stored) { try { pending.value = JSON.parse(stored) } catch { sessionStorage.removeItem(storageKey) } }
  void load()
})
</script>

<template>
  <section class="work-orders">
    <div class="admin-header"><h2>Pengerjaan / Work Order</h2><button :disabled="busy" @click="load">Perbarui daftar WO</button></div>
    <p class="muted">Kendaraan diterima → sedang dikerjakan → selesai dikerjakan. Pit dan pelaksana adalah data pekerjaan. Pembayaran dilakukan setelah pengerjaan selesai.</p>
    <p v-if="error" role="alert" class="notice error">{{ error }}</p><p v-if="notice" data-wo-success role="status" class="notice success">{{ notice }}</p>
    <div v-if="pending" class="notice"><p>Hasil submit belum dipastikan. Data asli dipertahankan setelah refresh.</p><button data-retry-wo :disabled="busy" @click="mutate()">Coba lagi perubahan tertunda</button></div>
    <div class="admin-columns section-actions">
      <section class="panel"><h3>WO aktif, termasuk lintas hari</h3><p v-if="!orders.length">Belum ada WO.</p><ul class="customer-list"><li v-for="w in orders" :key="w.id"><button :data-wo-booking="w.id" :disabled="busy || Boolean(pending)" @click="open(w.id)"><strong>{{ w.code }} · {{ w.vehicle.plate }}</strong><br>{{ bookingStatus(w.status) }}<br>{{ w.pit || 'Pit belum diisi' }} · {{ w.assignee || 'Pelaksana belum diisi' }}</button></li></ul></section>
      <section v-if="detail && fields" class="panel">
        <div class="admin-header"><h3>{{ fields.code }} · {{ fields.vehicle.plate }}</h3><button :disabled="busy || Boolean(pending)" data-reload-wo @click="open(fields.bookingId)">Muat ulang WO</button></div>
        <p>{{ fields.customerName }} · {{ fields.phone }}</p><p class="booking-complaint">Keluhan: {{ fields.complaint }}</p><p>Versi {{ fields.version }} · {{ bookingStatus(fields.status) }} · Pembayaran belum lunas</p>
        <form ref="form" @submit.prevent="mutate()">
          <fieldset :disabled="busy || Boolean(pending)">
            <div class="form-row"><label>Odometer (km)<input v-model.number="fields.odometer" name="woOdometer" type="number" min="0" max="9999999" step="1" required></label><label>Pit<input v-model="fields.pit" name="woPit" maxlength="60"></label><label>Pelaksana<input v-model="fields.assignee" name="woAssignee" maxlength="100"></label></div>
            <label class="section-actions">Kondisi awal<textarea v-model="fields.initialCondition" maxlength="2000" required /></label>
            <label>Diagnosa<textarea v-model="fields.diagnosis" name="woDiagnosis" maxlength="2000" /></label><label>Inspeksi<textarea v-model="fields.inspection" name="woInspection" maxlength="2000" /></label><label>Catatan / hasil pekerjaan<textarea v-model="fields.notes" name="woNotes" maxlength="4000" /></label>
            <p class="muted">Saat mulai: pit, pelaksana, diagnosa dan inspeksi wajib. Saat selesai: catatan hasil dan minimal satu jasa wajib.</p>
            <DraftCostEditor v-model="lines" :services="services" />
            <p data-draft-total>Total tersimpan: <strong>{{ bookingMoney(detail.draft.total) }}</strong> · jasa {{ bookingMoney(detail.draft.serviceSubtotal) }} · part {{ bookingMoney(detail.draft.partSubtotal) }}</p>
            <label>Alasan / ringkasan perubahan (wajib)<textarea v-model="reason" name="woReason" maxlength="500" required /></label>
            <div class="actions"><button data-save-wo type="submit">Simpan koreksi / draft</button><button v-if="fields.status === 'received'" data-start-wo type="button" class="primary" @click="mutate('start')">Mulai pengerjaan</button><button v-if="fields.status === 'in_progress'" data-complete-wo type="button" class="primary" @click="mutate('complete')">Selesai dikerjakan & kirim estimasi</button></div>
            <p v-if="fields.status === 'completed'" class="notice">Pengerjaan selesai. Estimasi WA mengikuti rincian saat pengerjaan diselesaikan; koreksi draft di sini tidak mengubah pesan tersebut. Lanjutkan ke pembayaran untuk menyelesaikan transaksi.</p>
            <section class="section-actions"><h4>Tautan tracking</h4><p v-if="detail.tracking.url"><a :href="detail.tracking.url" target="_blank" rel="noreferrer">Buka tracking pelanggan</a> · berlaku sampai {{ bookingTime(detail.tracking.expiresAt) }}</p><p v-else>Tautan kedaluwarsa atau dicabut.</p><p class="muted">Isi alasan terlebih dahulu. Rotasi membuat tautan baru selama 30 hari dan langsung membatalkan tautan lama. Perubahan formulir lainnya tidak ikut disimpan oleh tombol tracking.</p><div class="actions"><button type="button" data-rotate-tracking @click="mutate('rotate_tracking')">Rotasi / perbarui tautan</button><button type="button" data-revoke-tracking @click="mutate('revoke_tracking')">Cabut tautan</button></div></section>
          </fieldset>
        </form>
        <section class="section-actions"><h4>Timeline status</h4><ol><li v-for="h in detail.history" :key="h.version">{{ bookingStatus(h.status) }} · {{ bookingTime(h.occurredAt) }}<p v-if="h.estimate">Estimasi saat selesai {{ bookingMoney(h.estimate.total) }} · belum lunas</p></li></ol></section>
        <section class="section-actions"><h4>Audit perubahan WO</h4><p v-if="!detail.changes.length">Belum ada koreksi sejak penerimaan.</p><details v-for="c in detail.changes" :key="c.version"><summary>v{{ c.version }} · {{ c.action }} · {{ bookingTime(c.occurredAt) }} · {{ c.reason }}</summary><p>Aktor: {{ c.actorId }}</p><pre class="audit-json">{{ JSON.stringify({ sebelum: c.before, sesudah: c.after }, null, 2) }}</pre></details></section>
      </section><p v-else class="muted">Pilih WO untuk mengisi pengerjaan dan draft biaya.</p>
    </div>
  </section>
</template>
