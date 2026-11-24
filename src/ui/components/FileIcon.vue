<template>
  <span class="file-icon" :style="{ color: info.color }" v-html="info.svg" />
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({ name: { type: String, default: '' }, isDir: { type: Boolean, default: false }, open: { type: Boolean, default: false } });

/** 统一 14x14 线稿图形，靠颜色区分语言（VSCode Seti 的极简等效） */
const GLYPH = {
  dir: '<svg viewBox="0 0 16 16"><path d="M1.5 3.2h4.2l1.3 1.4h7.5v8.2H1.5z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  code: '<svg viewBox="0 0 16 16"><path d="M5.5 4.5L2.2 8l3.3 3.5M10.5 4.5L13.8 8l-3.3 3.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  bracket: '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M5 11V5l6 6" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
  style: '<svg viewBox="0 0 16 16"><path d="M2.6 6.5h10.8M2.6 9.5h10.8M5 3.2l2.2 9.6M10.5 3.2l-2.2 9.6" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
  doc: '<svg viewBox="0 0 16 16"><path d="M3.5 2h6.5l2.8 2.8v9.2H3.5z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6 6h4M6 8.5h4M6 11h2.5" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
  json: '<svg viewBox="0 0 16 16"><path d="M6 2.5C4 2.5 4.6 4.4 4.6 8s-.6 5.5-1.6 5.5M10 2.5c2 0 1.4 1.9 1.4 5.5s.6 5.5 1.6 5.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  vue: '<svg viewBox="0 0 16 16"><path d="M8 13L1.6 3h3.2L8 9.2 11.2 3h3.2z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 9.2L6.1 6.2h3.8z" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
};

const MAP = {
  js: { glyph: 'code', color: '#e9d16a' },
  mjs: { glyph: 'code', color: '#e9d16a' },
  cjs: { glyph: 'code', color: '#e9d16a' },
  ts: { glyph: 'code', color: '#4f9fe8' },
  tsx: { glyph: 'code', color: '#4f9fe8' },
  jsx: { glyph: 'code', color: '#7ec4ff' },
  vue: { glyph: 'vue', color: '#41b883' },
  json: { glyph: 'json', color: '#cbcb41' },
  md: { glyph: 'doc', color: '#8aa4c8' },
  css: { glyph: 'style', color: '#a074c4' },
  scss: { glyph: 'style', color: '#c77ab8' },
  html: { glyph: 'bracket', color: '#e37933' },
  yml: { glyph: 'doc', color: '#a8b9c8' },
  yaml: { glyph: 'doc', color: '#a8b9c8' },
  py: { glyph: 'code', color: '#5aa0d8' },
  go: { glyph: 'code', color: '#6ad4e0' },
  rs: { glyph: 'code', color: '#dea584' },
  sh: { glyph: 'code', color: '#89e051' },
};

const info = computed(() => {
  if (props.isDir) {
    return { svg: GLYPH.dir, color: props.open ? '#dcb67a' : '#c8ccd0' };
  }
  const ext = String(props.name).split('.').pop()?.toLowerCase() ?? '';
  const hit = MAP[ext] ?? { glyph: 'doc', color: '#9aa3ad' };
  return { svg: GLYPH[hit.glyph], color: hit.color };
});
</script>

<style scoped>
.file-icon { display: inline-flex; width: 14px; height: 14px; align-items: center; }
.file-icon :deep(svg) { width: 14px; height: 14px; display: block; }
</style>
