/**
 * UI 的唯一数据出口。
 * 原型阶段：全部走 `mock-api.js`（纯 ES6 静态数据，无 IPC）。
 * 对接主进程时：只改本文件里每个方法的实现（换成 window.herix.*），组件层零改动。
 * @module ui/api
 */
import { mockApi } from '../mock-api.js';

const impl = mockApi;

export const api = {
  appInfo: () => impl.appInfo(),
  /** 文件树：懒加载，dir 为空表示取根 */
  listDir: (projectId, dir) => impl.listDir(projectId, dir),
  expandedDirs: (projectId) => impl.expandedDirs(projectId),
  saveExpandedDirs: (projectId, dirs) => impl.saveExpandedDirs(projectId, dirs),
  /** 搜索：复刻 VSCode 的字段 */
  search: (projectId, query, options) => impl.search(projectId, query, options),
  gitChanges: (projectId) => impl.gitChanges(projectId),
  extensions: () => impl.extensions(),
  openFiles: () => impl.openFiles(),
  fileContent: (path) => impl.fileContent(path),
  symbols: (query) => impl.symbols(query),
  models: () => impl.models(),
  conversations: () => impl.conversations(),
  appendConversation: (payload) => impl.appendConversation(payload),
  terminals: () => impl.terminals(),
  outputs: () => impl.outputs(),
  copyToClipboard: (text) => impl.copyToClipboard(text),
};
