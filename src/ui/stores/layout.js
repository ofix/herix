/**
 * 布局状态：当前侧栏视图、编辑器多 tab、底部面板、预览/diff 开关。
 * 不用 Pinia：本应用状态量小，reactive 足够，还能少一层依赖。
 */
import { reactive } from 'vue';

export const layout = reactive({
  view: 'explorer', // explorer | search | git | extensions | settings
  tabs: [{ path: 'src/main/core/engine.js', lang: 'javascript', dirty: false }],
  activeTab: 'src/main/core/engine.js',
  previewOn: false,
  diffOn: false,
  bottomTab: 'ai', // ai | terminal | output
  terminalBadge: 2,
  symbolJump: null, // { file, line } 由 # 引用触发编辑器滚动
});

export function switchView(view) {
  layout.view = layout.view === view ? 'explorer' : view;
}

export function openTab(file) {
  if (!layout.tabs.some((t) => t.path === file.path)) layout.tabs.push({ ...file, dirty: false });
  layout.activeTab = file.path;
}

export function closeTab(path) {
  const i = layout.tabs.findIndex((t) => t.path === path);
  if (i < 0) return;
  layout.tabs.splice(i, 1);
  if (layout.activeTab === path) layout.activeTab = layout.tabs[Math.max(0, i - 1)]?.path ?? '';
}

export function jumpToSymbol(target) {
  layout.symbolJump = { ...target, at: Date.now() };
}
