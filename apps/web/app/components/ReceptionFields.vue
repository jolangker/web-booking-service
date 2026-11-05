<script setup lang="ts">
const value = defineModel<ReceptionPhysical>({ required: true })
</script>

<template>
  <label>Odometer (km)<input v-model.number="value.odometer" name="odometer" type="number" min="0" max="9999999" step="1" required></label>
  <label>Kondisi awal kendaraan<textarea v-model="value.initialCondition" name="initialCondition" rows="3" required maxlength="2000" placeholder="Catat kondisi fisik, goresan, atau kerusakan awal." /></label>
  <div class="form-row">
    <label>Pit (opsional)<input v-model="value.pit" name="pit" maxlength="60"></label>
    <label>Pelaksana (opsional)<input v-model="value.assignee" name="assignee" maxlength="100"></label>
  </div>
</template>
