<template>
  <div class="explorer">
    <div class="project-row">
      <span class="chev">▾</span><span class="name">herix</span>
      <span class="muted">{{ rows.length }} 项</span>
    </div>
    <RecycleScroller
      v-if="rows.length"
      class="tree"
      :items="rows"
      :item-size="22"
      key-field="path"
      :buffer="400"
      v-slot="{ item }"
    >
      <div
        class="row"
        :style="{ paddingLeft: 8 + item.depth * 14 + 'px' }"
        @click="onClick(item)"
      >
        <span class="twisty">{{ item.isDir ? (tree.expanded.has(item.path) ? '▾' : '▸') : '' }}</span>
        <FileIcon :name="item.name" :is-dir="item.isDir" :open="tree.expanded.has(item.path)" />
        <span class="label" :title="item.path">{{ item.name }}</span>
        <span v-if="tree.loading[item.path]" class="muted">…</span>
      </div>
    </RecycleScroller>
    <div v-else class="empty">目录为空</div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { RecycleScroller } from 'vue-virtual-scroller';
import { tree, expand, visibleRows } from '../../stores/project.js';
import { openTab } from '../../stores/layout.js';
import FileIcon from '../FileIcon.vue';

const rows = computed(() => visibleRows());

function onClick(row) {
  if (row.isDir) void expand(row.path);
  else openTab({ path: row.path, lang: guessLang(row.name) });
}

const guessLang = (name) => {
  if (name.endsWith('.vue')) return 'html';
  if (name.endsWith('.ts')) return 'typescript';
  if (name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.cjs')) return 'javascript';
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.md')) return 'markdown';
  if (name.endsWith('.css') || name.endsWith('.scss')) return 'css';
  return 'plaintext';
};
</script>

<style scoped>
.explorer { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.project-row { display: flex; align-items: center; gap: 6px; padding: 6px 10px; font-size: 12px; flex: none; }
.project-row .muted { margin-left: auto; color: var(--fg-dim); font-size: 11px; }
.tree { flex: 1; overflow: auto; min-height: 0; }
.row {
  display: flex; align-items: center; gap: 5px; height: 22px; cursor: pointer; font-size: 12px;
  white-space: nowrap;
}
.row:hover { background: var(--bg-hover); }
.twisty { width: 10px; color: var(--fg-dim); font-size: 10px; flex: none; }
.label { overflow: hidden; text-overflow: ellipsis; }
.muted { color: var(--fg-dim); margin-left: 6px; }
.empty { padding: 12px; color: var(--fg-dim); font-size: 12px; }
</style>
