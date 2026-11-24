<template>
  <aside class="sidebar">
    <div class="sidebar-title">{{ titles[layout.view] }}</div>
    <ExplorerPanel v-if="layout.view === 'explorer'" />
    <SearchPanel v-else-if="layout.view === 'search'" />
    <GitPanel v-else-if="layout.view === 'git'" />
    <ExtensionsPanel v-else-if="layout.view === 'extensions'" />
    <SettingsPanel v-else />
  </aside>
</template>

<script setup>
  import { layout } from "../stores/layout.js";
  import ExplorerPanel from "./panels/ExplorerPanel.vue";
  import SearchPanel from "./panels/SearchPanel.vue";
  import GitPanel from "./panels/GitPanel.vue";
  import ExtensionsPanel from "./panels/ExtensionsPanel.vue";
  import SettingsPanel from "./panels/SettingsPanel.vue";

  const titles = {
    explorer: "资源管理器",
    search: "搜索",
    git: "源代码管理",
    extensions: "扩展",
    settings: "设置",
  };
</script>

<style scoped>
  .sidebar {
    width: 100%;
    height: 100%;
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .sidebar-title {
    padding: 8px 12px;
    font-size: 11px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--fg-dim);
    border-bottom: 1px solid var(--border);
  }
</style>
