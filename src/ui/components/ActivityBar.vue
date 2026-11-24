<template>
  <aside class="activity">
    <div class="group top">
      <button
        v-for="item in top"
        :key="item.key"
        class="icon-btn"
        :class="{ on: layout.view === item.key }"
        :title="item.title"
        @click="switchView(item.key)"
      >
        <span class="ico" v-html="item.icon" />
        <span v-if="item.badge" class="badge">{{ item.badge }}</span>
      </button>
    </div>
    <div class="group lower">
      <button
        class="icon-btn"
        :class="{ on: layout.view === 'settings' }"
        title="设置"
        @click="switchView('settings')"
      >
        <span class="ico" v-html="icons.gear" />
      </button>
    </div>
  </aside>
</template>

<script setup>
  import { layout, switchView } from "../stores/layout.js";

  const icons = {
    files:
      '<svg viewBox="0 0 24 24"><path d="M4 3h10l4 4v14H4z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M13 3v5h5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    search:
      '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="1.6"/></svg>',
    git: '<svg viewBox="0 0 24 24"><circle cx="7" cy="6" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="18" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="17" cy="10" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 8v8M7 12h6a4 4 0 0 0 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    ext: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="14" y="14" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 7h4v4M14 11v3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" stroke="currentColor" stroke-width="1.4"/></svg>',
  };

  const top = [
    { key: "explorer", title: "资源管理器", icon: icons.files },
    { key: "search", title: "搜索", icon: icons.search },
    { key: "git", title: "源代码管理", icon: icons.git },
    { key: "extensions", title: "扩展", icon: icons.ext, badge: 0 },
  ];
</script>

<style scoped>
  .activity {
    width: 48px;
    flex: none;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 6px 0;
  }
  .group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .lower {
    margin-top: auto;
  }
  .icon-btn {
    position: relative;
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--fg-dim);
    cursor: pointer;
    display: grid;
    place-items: center;
  }
  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--fg);
  }
  .icon-btn.on {
    color: var(--fg);
    background: #2f3336;
    box-shadow: inset 2px 0 0 var(--accent-2);
  }
  .ico :deep(svg) {
    width: 18px;
    height: 18px;
    display: block;
  }
  .badge {
    position: absolute;
    right: 4px;
    bottom: 3px;
    background: var(--accent-2);
    color: #fff;
    font-size: 10px;
    border-radius: 8px;
    padding: 0 5px;
    line-height: 14px;
  }
</style>
