<template>
  <section class="editor">
    <div class="tabbar">
      <el-tabs v-model="layout.activeTab" type="card" class="code-tabs" @tab-remove="closeTab">
        <el-tab-pane
          v-for="t in layout.tabs"
          :key="t.path"
          :name="t.path"
          :label="baseName(t.path)"
          closable
        />
      </el-tabs>
      <div class="actions">
        <button
          :class="{ on: layout.diffOn }"
          title="Diff 视图"
          @click="layout.diffOn = !layout.diffOn"
        >
          Diff
        </button>
      </div>
    </div>

    <div class="body" :class="{ 'no-file': !layout.tabs.length }">
      <div class="code-pane">
        <div ref="monacoEl" class="monaco-host" />
      </div>
      <div v-if="layout.previewOn" class="preview-pane scroll-thin">
        <div class="preview-head">预览 · {{ baseName(layout.activeTab) }}</div>
        <pre class="preview-body">{{ content }}</pre>
      </div>

      <div v-if="chat.overlayVisible" class="editor-mask" @click="hideOverlay" />
      <ChatPanel v-if="chat.overlayVisible" :empty="!layout.tabs.length" />
    </div>
  </section>
</template>

<script setup>
  import { onMounted, onUnmounted, ref, watch, nextTick } from "vue";
  import * as monaco from "monaco-editor";
  import { layout, closeTab } from "../stores/layout.js";
  import { chat } from "../stores/chat.js";
  import { api } from "../api/index.js";
  import ChatPanel from "./ChatPanel.vue";

  const monacoEl = ref(null);
  const content = ref("");
  let editor = null;
  let diffEditor = null;
  // 追踪当前手动创建的 model，便于统一销毁
  let currentModels = [];

  /** 安全销毁所有手动创建的 model */
  function disposeModels() {
    currentModels.forEach(m => m?.dispose());
    currentModels = [];
  }

  function rebuildEditor() {
    // 1. 先销毁旧的 model
    disposeModels();

    // 2. 销毁旧的 diffEditor（如果存在）
    if (diffEditor) {
      diffEditor.dispose();
      diffEditor = null;
    }

    // 3. 如果普通 editor 已存在，直接复用并更新内容，无需重建
    if (editor && !editor.isDisposed()) {
      const model = editor.getModel();
      if (model) {
        model.setValue(content.value);
        monaco.editor.setModelLanguage(model, getCurrentLang());
      }
      return;
    }

    // 4. 仅在首次或 editor 被意外销毁时才创建新实例
    // 注意：不再使用 innerHTML = ""
    editor = monaco.editor.create(monacoEl.value, {
      value: content.value,
      language: getCurrentLang(),
      theme: "vs-dark",
      minimap: { enabled: false },
      fontSize: 13,
      automaticLayout: true,
      scrollBeyondLastLine: false,
    });
  }

  function rebuildDiff() {
    // 1. 销毁旧 model
    disposeModels();

    // 2. 销毁普通 editor（如果存在）
    if (editor) {
      editor.dispose();
      editor = null;
    }

    // 3. 创建新的 model 并追踪
    const original = monaco.editor.createModel(content.value || "// 无改动", "javascript");
    const modified = monaco.editor.createModel(
      `${content.value}\n\n// --- 待审批改动（mock）\n// + 新增一行示例\n`,
      "javascript"
    );
    currentModels = [original, modified];

    // 4. 复用或创建 DiffEditor
    if (!diffEditor || diffEditor.isDisposed()) {
      // 不再使用 innerHTML = ""，Monaco 会在 dispose 时自行清理 DOM
      diffEditor = monaco.editor.createDiffEditor(monacoEl.value, {
        theme: "vs-dark",
        fontSize: 13,
        automaticLayout: true,
        renderSideBySide: true,
        readOnly: true,
      });
    }

    diffEditor.setModel({ original, modified });
  }

  // 辅助函数：获取当前 tab 语言
  function getCurrentLang() {
    const tab = layout.tabs.find(t => t.path === layout.activeTab);
    return tab?.lang || "javascript";
  }

  onUnmounted(() => {
    disposeModels();
    editor?.dispose();
    diffEditor?.dispose();
    editor = null;
    diffEditor = null;
  });

  const baseName = p =>
    String(p ?? "")
      .split("/")
      .pop();

  /** 点击遮罩收起历史浮层，但不打断输入框焦点逻辑 */
  const hideOverlay = () => {
    chat.overlayVisible = false;
  };

  onMounted(() => {
    editor = monaco.editor.create(monacoEl.value, {
      value: "",
      language: "javascript",
      theme: "vs-dark",
      minimap: { enabled: false },
      fontSize: 13,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      renderLineHighlight: "line",
    });
    void loadActive();
  });

  async function loadActive() {
    const tab = layout.tabs.find(t => t.path === layout.activeTab);
    content.value = "";
    if (!tab) return;
    const r = await api.fileContent(tab.path);
    content.value = r.content;
    if (!editor) return;
    editor.setValue(r.content);
    monaco.editor.setModelLanguage(editor.getModel(), tab.lang);
    editor.setScrollTop(0);
  }

  watch(
    () => layout.activeTab,
    () => {
      if (layout.diffOn) rebuildDiff();
      else void loadActive();
    }
  );

  watch(
    () => layout.diffOn,
    () => {
      if (!editor || !monacoEl.value) return;
      if (layout.diffOn) rebuildDiff();
      else rebuildEditor();
    }
  );

  watch(
    () => layout.symbolJump,
    target => {
      if (!target) return;
      nextTick(() => {
        if (!editor) return;
        const line = Math.max(1, target.line ?? 1);
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        editor.focus();
      });
    }
  );
</script>

<style scoped>
  .editor {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg);
  }
  .tabbar {
    display: flex;
    align-items: flex-end;
    border-bottom: 1px solid var(--border);
  }
  .code-tabs {
    flex: 1;
    min-width: 0;
  }
  .actions {
    display: flex;
    gap: 6px;
    padding: 0 8px 5px;
  }
  .actions button {
    background: #3a3d41;
    color: var(--fg-dim);
    border: 1px solid var(--border);
    border-radius: 3px;
    font-size: 11px;
    padding: 3px 8px;
    cursor: pointer;
  }
  .actions button.on {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
  .body {
    flex: 1;
    display: flex;
    min-height: 0;
    position: relative;
  }
  /* .editor-mask {
    position: absolute;
    inset: 0;
    z-index: 20;
    background: rgba(0, 0, 0, 0.42);
    backdrop-filter: blur(1px);
  } */
  .code-pane {
    flex: 1;
    min-width: 0;
  }
  .monaco-host {
    width: 100%;
    height: 100%;
  }
  .preview-pane {
    width: 42%;
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }
  .preview-head {
    padding: 6px 10px;
    font-size: 11px;
    color: var(--fg-dim);
    border-bottom: 1px solid var(--border);
  }
  .preview-body {
    margin: 0;
    padding: 10px;
    overflow: auto;
    font: 12px/1.6 ui-monospace, monospace;
    color: #cfd4dc;
    white-space: pre-wrap;
  }
</style>
