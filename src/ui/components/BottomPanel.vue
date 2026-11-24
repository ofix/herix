<template>
  <section class="bottom">
    <div v-if="layout.bottomTab === 'ai'" class="ai">
      <div class="input-wrap">
        <div class="mirror" aria-hidden="true" v-html="highlighted" />
        <textarea
          ref="taEl"
          v-model="text"
          class="ta"
          rows="2"
          placeholder="和当前模型对话，输入 @ 选模型、# 引用代码…"
          @focus="onFocus(true, $event)"
          @blur="onFocus(false, $event)"
          @input="onInput"
          @keydown="onKeydown"
        />
      </div>
      <MentionPicker
        v-if="picker"
        :trigger="picker"
        :models="chat.models"
        :symbols="symbols"
        :active-file="layout.activeTab"
        :index="activeIndex"
        @pick="applyPick"
        @hover="activeIndex = $event"
      />
    </div>

    <div v-else-if="layout.bottomTab === 'terminal'" class="pane scroll-thin">
      <div v-for="t in terminals" :key="t.id" class="term">
        <div class="term-head">
          <span class="prompt">$</span>{{ t.title }}<span class="time">{{ t.clock }}</span>
        </div>
        <pre class="term-body">{{ t.lines.join("\n") }}</pre>
      </div>
    </div>

    <div v-else class="pane scroll-thin">
      <div v-for="o in outputs" :key="o.id" class="out">
        <span class="time">{{ o.clock }}</span
        >{{ o.text }}
      </div>
    </div>
    <div class="bar">
      <button class="tab" :class="{ on: layout.bottomTab === 'ai' }" @click="setTab('ai')">
        <span class="dot" />AI
      </button>
      <button
        class="tab"
        :class="{ on: layout.bottomTab === 'terminal' }"
        @click="setTab('terminal')"
      >
        终端
        <span v-if="layout.terminalBadge" class="num">{{ layout.terminalBadge }}</span>
      </button>
      <button class="tab" :class="{ on: layout.bottomTab === 'output' }" @click="setTab('output')">
        输出
      </button>
      <span class="spacer" />
      <span class="model-chip" :title="'当前对话模型'">
        <span class="model-dot" :style="{ background: current?.color }" />{{ current?.name }}
      </span>
      <button class="send" :disabled="!text.trim() || chat.pendingSend" @click="send">发送</button>
    </div>
  </section>
</template>

<script setup>
  import { computed, nextTick, onMounted, ref, watch } from "vue";
  import { layout } from "../stores/layout.js";
  import {
    chat,
    setOverlayFocus,
    sendMessage,
    currentModelMeta,
    applyModelMentions,
    collectRefs,
  } from "../stores/chat.js";
  import { activeTrigger } from "../utils/mention.js";
  import { api } from "../api/index.js";
  import { jumpToSymbol } from "../stores/layout.js";
  import MentionPicker from "./MentionPicker.vue";

  const text = ref("");
  const taEl = ref(null);
  const picker = ref(null);
  const symbols = ref([]);
  const activeIndex = ref(0);
  const terminals = ref([]);
  const outputs = ref([]);
  const current = currentModelMeta;

  const escapeHtml = s =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const highlighted = computed(() => {
    const src = escapeHtml(text.value);
    return (
      src.replace(/([@#][\w\u4e00-\u9fa5./-]+)/g, m => {
        const cls = m.startsWith("@") ? "hl-model" : "hl-ref";
        return `<span class="${cls}">${m}</span>`;
      }) + "\u200b"
    );
  });

  function setTab(t) {
    layout.bottomTab = t;
    if (t === "terminal") layout.terminalBadge = 0;
  }

  function onFocus(focused, ev) {
    // 焦点移入历史浮层内部时不移除浮层，否则点击历史条目会先把浮层关掉
    if (!focused && ev?.relatedTarget?.closest?.(".overlay")) return;
    setOverlayFocus(focused);
  }

  function onInput() {
    const caret = taEl.value?.selectionStart ?? text.value.length;
    const trig = activeTrigger(text.value, caret);
    if (!trig) {
      picker.value = null;
      return;
    }
    picker.value = trig;
    activeIndex.value = 0;
    void loadSymbols(trig);
  }

  async function loadSymbols(trig) {
    if (trig.char === "#") symbols.value = await api.symbols(trig.query);
    else symbols.value = [];
  }

  function onKeydown(e) {
    if (!picker.value) return;
    const list = candidates.value;
    if (!list.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex.value = (activeIndex.value + 1) % list.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex.value = (activeIndex.value - 1 + list.length) % list.length;
    } else if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault();
      applyPick(list[activeIndex.value]);
    } else if (e.key === "Escape") {
      picker.value = null;
    }
  }

  const candidates = computed(() => {
    if (!picker.value) return [];
    if (picker.value.char === "@") {
      const q = picker.value.query.toLowerCase();
      return chat.models
        .filter(m => (m.online && m.name.toLowerCase().includes(q)) || m.id.includes(q))
        .slice(0, 6);
    }
    return symbols.value.map(s => ({ ...s, kind: "symbol" }));
  });

  function applyPick(item) {
    if (!item || !picker.value) return;
    const token = picker.value.char === "@" ? `@${item.name ?? item.id} ` : `#${item.name}`;
    const caret = taEl.value?.selectionStart ?? text.value.length;
    const start = picker.value.start;
    text.value = `${text.value.slice(0, start)}${token}${text.value.slice(caret)}`;
    picker.value = null;
    if (item.kind === "symbol" || item.line) {
      jumpToSymbol({ file: item.file, line: item.line });
      openSymbolFile(item);
    }
    nextTick(() => taEl.value?.focus());
  }

  function openSymbolFile(item) {
    if (!item?.file) return;
    layout.activeTab = item.file;
    if (!layout.tabs.some(t => t.path === item.file)) {
      layout.tabs.push({ path: item.file, lang: "javascript", dirty: false });
    }
  }

  async function send() {
    const refs = collectRefs(text.value);
    const models = [...text.value.matchAll(/@([\w\u4e00-\u9fa5]+)/g)].map(m => m[1]);
    applyModelMentions(models);
    const item = await sendMessage(text.value, refs);
    if (item) {
      layout.bottomTab = "ai";
      chat.overlayVisible = true;
    }
  }

  watch(
    () => layout.bottomTab,
    t => {
      if (t !== "ai") setOverlayFocus(false);
    }
  );

  onMounted(async () => {
    terminals.value = await api.terminals();
    outputs.value = await api.outputs();
  });
</script>

<style scoped>
  .bottom {
    background: var(--bg-panel);
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 8px;
    border-top: 1px solid var(--border);
    background: #202225;
    flex: none;
  }
  .tab {
    background: transparent;
    border: 0;
    color: var(--fg-dim);
    font-size: 11.5px;
    padding: 4px 10px;
    border-radius: 3px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .tab:hover {
    color: var(--fg);
    background: var(--bg-hover);
  }
  .tab.on {
    color: var(--fg);
    border-bottom: 1px solid var(--accent-2);
    border-radius: 0;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-2);
  }
  .num {
    background: var(--accent-2);
    color: #fff;
    font-size: 10px;
    border-radius: 8px;
    min-width: 15px;
    text-align: center;
    padding: 0 4px;
    line-height: 14px;
  }
  .spacer {
    flex: 1;
  }
  .model-chip {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--fg-dim);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 2px 8px;
    margin-right: 8px;
  }
  .model-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .send {
    background: var(--accent);
    color: #fff;
    border: 0;
    border-radius: 3px;
    font-size: 11.5px;
    padding: 4px 14px;
    cursor: pointer;
  }
  .send:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .ai {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    min-height: 0;
    position: relative;
  }
  .input-wrap {
    position: relative;
    flex: 1;
    min-height: 46px;
  }
  .mirror,
  .ta {
    position: absolute;
    inset: 0;
    padding: 6px 8px;
    font: 12.5px/1.6 inherit;
    font-family: inherit;
    white-space: pre-wrap;
    word-break: break-word;
    overflow: auto;
  }
  .mirror {
    color: transparent;
    pointer-events: none;
  }
  .mirror :deep(.hl-model) {
    color: rgba(78, 201, 176, 0.95);
  }
  .mirror :deep(.hl-ref) {
    color: rgba(215, 186, 125, 0.95);
  }
  .ta {
    background: #22262a;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: transparent;
    caret-color: var(--fg);
    resize: none;
    outline: none;
  }
  .ta:focus {
    border-color: var(--accent-2);
  }
  .pane {
    flex: 1;
    overflow: auto;
    padding: 8px 10px;
    min-height: 0;
  }
  .term {
    margin-bottom: 8px;
  }
  .term-head {
    font-family: ui-monospace, monospace;
    font-size: 11.5px;
    color: var(--fg-dim);
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .prompt {
    color: var(--green);
  }
  .time {
    margin-left: auto;
  }
  .term-body {
    margin: 4px 0 0;
    font: 11.5px/1.55 ui-monospace, monospace;
    color: #c9d1d9;
    white-space: pre-wrap;
  }
  .out {
    font-size: 11.5px;
    font-family: ui-monospace, monospace;
    color: #c9d1d9;
    padding: 3px 0;
  }
  .out .time {
    color: var(--fg-dim);
    margin-right: 8px;
  }
</style>
