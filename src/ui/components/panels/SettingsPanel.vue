<template>
  <div class="settings">
    <div class="row"><span>当前模型</span><span class="v">{{ current?.name ?? '-' }}</span></div>
    <div class="row"><span>对话历史</span><span class="v">{{ chat.conversations.length }} 次</span></div>
    <div class="row"><span>终端</span><span class="v">{{ layout.terminalBadge }} 条新输出</span></div>
    <div class="hint">原型阶段数据来自 mock-api.js；对接主进程后此面板读真实配置。</div>
  </div>
</template>

<script setup>
import { chat, currentModelMeta } from '../../stores/chat.js';
import { layout } from '../../stores/layout.js';

const current = currentModelMeta;
</script>

<style scoped>
.settings { padding: 12px; display: flex; flex-direction: column; gap: 10px; font-size: 12px; }
.row { display: flex; justify-content: space-between; color: var(--fg-dim); }
.v { color: var(--fg); }
.hint { margin-top: 12px; color: var(--fg-dim); font-size: 11px; line-height: 1.6; }
</style>
