<script setup lang="ts">
const props = defineProps<{ status: string, reservationStatus?: string }>()
const stages = [
  { id: 'confirmed', label: 'Booking', icon: 'calendar-days' },
  { id: 'received', label: 'Diterima', icon: 'car' },
  { id: 'in_progress', label: 'Dikerjakan', icon: 'wrench' },
  { id: 'completed', label: 'Selesai kerja', icon: 'check' },
  { id: 'collected', label: 'Lunas', icon: 'check-check' },
]
const current = computed(() => stages.findIndex(item => item.id === props.status))
</script>

<template>
  <p v-if="reservationStatus === 'cancelled'" class="notice">Reservasi dibatalkan</p>
  <ol v-else class="visit-progress" aria-label="Tahapan kunjungan">
    <li v-for="(stage, index) in stages" :key="stage.id" :class="{ reached: index <= current, current: index === current }" :aria-current="index === current ? 'step' : undefined">
      <span class="progress-node"><AppIcon :name="index < current ? 'check' : stage.icon" /></span><span>{{ stage.label }}</span>
    </li>
  </ol>
</template>
