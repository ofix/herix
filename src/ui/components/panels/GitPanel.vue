<template>
  <div class="git">
    <div class="branch">
      <span>⎇ {{ info.branch }}</span>
      <span class="muted">ahead {{ info.ahead }}</span>
    </div>
    <input v-model="msg" class="commit-msg" placeholder="提交信息（Ctrl+Enter 提交）" @keydown.ctrl.enter="noop" />
    <button class="commit-btn" :disabled="!info.changes.length" @click="noop">提交 {{ info.changes.length }} 个文件</button>
    <div class="changes scroll-thin">
      <div v-for="c in info.changes" :key="c.path" class="chg">
        <span class="st" :class="'st-' + c.status">{{ c.status }}</span>
        <span class="path">{{ c.path }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../api/index.js';

const info = reactive({ branch: '-', ahead: 0, changes: [] });
const msg = ref('');
onMounted(async () => Object.assign(info, await api.gitChanges()));
const noop = () => {};
</script>

<style scoped>
.git { display: flex; flex-direction: column; gap: 8px; padding: 10px; min-height: 0; height: 100%; }
.branch { display: flex; justify-content: space-between; font-size: 12px; }
.muted { color: var(--fg-dim); }
.commit-msg { background: #3c3c3c; border: 0; border-radius: 3px; color: var(--fg); padding: 6px; font: inherit; outline: none; }
.commit-btn { background: var(--accent); color: #fff; border: 0; border-radius: 3px; padding: 6px; cursor: pointer; }
.commit-btn:disabled { opacity: .4; cursor: default; }
.changes { overflow: auto; flex: 1; font-size: 12px; }
.chg { display: flex; gap: 8px; padding: 3px 4px; }
.st { width: 14px; font-family: ui-monospace, monospace; }
.st-M { color: var(--amber); } .st-A { color: var(--green); } .st-D { color: var(--red); }
.path { color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
