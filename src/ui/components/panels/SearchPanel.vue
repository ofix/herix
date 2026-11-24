<template>
  <div class="search">
    <div class="field">
      <input v-model="query" placeholder="搜索" @keydown.enter="run" />
      <span class="opts">
        <button :class="{ on: matchCase }" title="区分大小写" @click="matchCase = !matchCase">Aa</button>
        <button :class="{ on: wholeWord }" title="全字匹配" @click="wholeWord = !wholeWord">ab</button>
        <button :class="{ on: regex }" title="正则" @click="regex = !regex">.*</button>
      </span>
    </div>
    <div class="field"><input v-model="replace" placeholder="替换" /></div>
    <div class="meta">{{ result.total }} 个结果{{ result.truncated ? '（已截断）' : '' }}</div>
    <div class="results scroll-thin">
      <div v-for="r in result.results" :key="r.file + r.line" class="hit" @click="open(r)">
        <div class="hit-file">{{ r.file }}<span class="line">:{{ r.line }}</span></div>
        <div class="hit-text">{{ r.preview }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { api } from '../../api/index.js';
import { openTab } from '../../stores/layout.js';

const query = ref('');
const replace = ref('');
const matchCase = ref(false);
const wholeWord = ref(false);
const regex = ref(false);
const result = reactive({ total: 0, results: [], truncated: false });

async function run() {
  const r = await api.search('prj_0011aabb', query.value, { matchCase: matchCase.value, wholeWord: wholeWord.value, regex: regex.value });
  result.total = r.total;
  result.results = r.results;
  result.truncated = r.total > r.results.length;
}

function open(r) {
  openTab({ path: r.file, lang: r.file.endsWith('.vue') ? 'html' : 'javascript' });
}
</script>

<style scoped>
.search { padding: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.field { display: flex; gap: 4px; }
.field input {
  flex: 1; background: #3c3c3c; border: 1px solid #3c3c3c; color: var(--fg);
  border-radius: 3px; padding: 4px 6px; font: inherit; outline: none;
}
.field input:focus { border-color: var(--accent-2); }
.opts { display: flex; gap: 2px; }
.opts button {
  width: 24px; background: #3c3c3c; color: var(--fg-dim); border: 1px solid transparent;
  border-radius: 3px; cursor: pointer; font-size: 11px;
}
.opts button.on { background: var(--accent); color: #fff; }
.meta { color: var(--fg-dim); font-size: 11px; }
.results { overflow: auto; flex: 1; }
.hit { padding: 4px 6px; cursor: pointer; border-radius: 3px; }
.hit:hover { background: var(--bg-hover); }
.hit-file { font-size: 11px; color: var(--fg-dim); }
.hit-text { font-family: ui-monospace, monospace; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
