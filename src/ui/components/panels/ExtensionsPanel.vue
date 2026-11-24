<template>
  <div class="ext scroll-thin">
    <div v-for="e in list" :key="e.id" class="card">
      <div class="head">
        <span class="name">{{ e.name }}</span>
        <span class="tag" :class="{ on: e.enabled }">{{ e.enabled ? '已启用' : '已停用' }}</span>
      </div>
      <div class="desc">{{ e.desc }}</div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../../api/index.js';

const list = ref([]);
onMounted(async () => { list.value = await api.extensions(); });
</script>

<style scoped>
.ext { padding: 10px; overflow: auto; height: 100%; display: flex; flex-direction: column; gap: 8px; }
.card { background: #2d2d2d; border: 1px solid var(--border); border-radius: 4px; padding: 8px; }
.head { display: flex; justify-content: space-between; align-items: center; }
.name { font-weight: 600; font-size: 12px; }
.tag { font-size: 10px; color: var(--fg-dim); border: 1px solid var(--border); padding: 0 4px; border-radius: 3px; }
.tag.on { color: var(--green); border-color: #2f5d4f; }
.desc { color: var(--fg-dim); font-size: 11px; margin-top: 4px; }
</style>
