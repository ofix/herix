<template>
  <div class="picker">
    <div class="head">{{ trigger.char === '@' ? '切换对话模型（可多选）' : '引用代码' }}</div>
    <div v-if="trigger.char === '#'" class="quick">
      <button class="qi" @click="$emit('pick', { kind: 'file', name: 'file:' + activeFile, file: activeFile })">
        <span class="tag">文件</span>当前文件内容 · {{ activeFile || '未打开' }}
      </button>
    </div>
    <div class="list">
      <button
        v-for="(c, i) in candidates"
        :key="(c.id ?? c.name) + i"
        class="item"
        :class="{ on: i === index }"
        @mouseenter="$emit('hover', i)"
        @click="$emit('pick', c)"
      >
        <span class="dot" :style="{ background: c.color ?? '#8b93a1' }" v-if="trigger.char === '@'" />
        <span class="tag" v-else>{{ c.kind === 'file' ? '文件' : '符号' }}</span>
        <span class="name">{{ c.name ?? c.label }}</span>
        <span class="meta">{{ c.signature ?? c.file ?? '' }}</span>
      </button>
      <div v-if="!candidates.length" class="empty">无匹配</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  trigger: { type: Object, required: true },
  models: { type: Array, default: () => [] },
  symbols: { type: Array, default: () => [] },
  activeFile: { type: String, default: '' },
  index: { type: Number, default: 0 },
});
defineEmits(['pick', 'hover']);

const candidates = computed(() => {
  const q = String(props.trigger?.query ?? '').toLowerCase();
  if (props.trigger?.char === '@') {
    return props.models
      .filter((m) => m.online)
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.id.includes(q))
      .slice(0, 6)
      .map((m) => ({ ...m, name: m.name }));
  }
  return props.symbols.map((s) => ({ ...s, kind: 'symbol' }));
});
</script>

<style scoped>
.picker {
  position: absolute; left: 8px; right: 8px; bottom: 58px; z-index: 40;
  background: #25282c; border: 1px solid #3c3c3c; border-radius: 6px;
  box-shadow: 0 -10px 26px rgba(0, 0, 0, .45); max-height: 220px; overflow: auto;
}
.head { padding: 6px 10px; font-size: 10.5px; color: var(--fg-dim); border-bottom: 1px solid #333; }
.quick { padding: 6px; }
.qi, .item {
  width: 100%; display: flex; align-items: center; gap: 8px; background: transparent; border: 0;
  color: var(--fg); text-align: left; padding: 5px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;
}
.item:hover, .item.on, .qi:hover { background: rgba(255, 255, 255, .07); }
.dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.tag { font-size: 10px; color: var(--fg-dim); border: 1px solid #3c3c3c; border-radius: 3px; padding: 0 4px; flex: none; }
.name { font-size: 12px; flex: none; }
.meta { color: var(--fg-dim); font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { padding: 10px; color: var(--fg-dim); font-size: 11px; }
</style>
