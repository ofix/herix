/**
 * 文件树：懒加载 + 展开态持久化（按 projectId）。
 * 性能要点：只在展开时请求子级；展开态写回主进程（原型里写 mock，真实环境落 state 文件）。
 */
import { reactive } from 'vue';
import { api } from '../api/index.js';

const PROJECT_ID = 'prj_0011aabb';

export const tree = reactive({
  projectId: PROJECT_ID,
  nodes: {}, // path -> children[]
  expanded: new Set(),
  loading: {},
});

export async function initTree() {
  const [root, dirs] = await Promise.all([api.listDir(PROJECT_ID, ''), api.expandedDirs(PROJECT_ID)]);
  tree.nodes[''] = root;
  for (const d of dirs) queueMicrotask(() => expand(d, true));
}

export async function expand(path, silent = false) {
  if (tree.expanded.has(path) && !silent) {
    tree.expanded.delete(path);
    await persist();
    return;
  }
  if (!tree.nodes[path]) {
    tree.loading[path] = true;
    tree.nodes[path] = await api.listDir(PROJECT_ID, path);
    tree.loading[path] = false;
  }
  tree.expanded.add(path);
  await persist();
}

/** 恢复到上次展开的层级：只加载到曾经展开过的目录，不预读更深 */
async function persist() {
  await api.saveExpandedDirs(PROJECT_ID, [...tree.expanded]);
}

/** 扁平化成可渲染的可见行（供虚拟列表用） */
export function visibleRows() {
  const rows = [];
  const walk = (dir, depth) => {
    for (const node of tree.nodes[dir] ?? []) {
      rows.push({ ...node, depth });
      if (node.isDir && tree.expanded.has(node.path)) walk(node.path, depth + 1);
    }
  };
  walk('', 0);
  return rows;
}
