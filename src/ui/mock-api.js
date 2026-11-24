/**
 * 【原型专用】全部模拟数据。对接主进程后整文件删除，只保留 api/index.js。
 * 约定：所有函数返回 Promise，字段形状即真实 IPC 契约形状。
 * @module ui/mock-api
 */
import { formatClock } from './utils/time.js';

const now = () => new Date().toISOString();
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

/** 大文件树：故意造 2000 个节点，验证懒加载与虚拟滚动 */
const FILE_TREE = {
  '': ['src', 'docs', 'scripts', 'package.json', 'README.md'],
  src: ['main', 'ui', 'workers', 'libs'],
  'src/main': ['core', 'git', 'ipc', 'bootstrap.js'],
  'src/main/core': ['engine.js', 'scheduler.js', 'site-queue.js', 'conference'],
  'src/ui': ['App.vue', 'main.js', 'components', 'mock-api.js'],
  'src/ui/components': ['ActivityBar.vue', 'EditorArea.vue', 'BottomPanel.vue', 'ChatHistoryOverlay.vue'],
  'src/workers': ['playwright-worker'],
  'src/libs': ['contracts', 'schemas', 'utils'],
};

const SEED_EXPANDED = { prj_0011aabb: ['src', 'src/main', 'src/ui'] };

const FILE_TREE_DIRS = new Set(Object.keys(FILE_TREE).filter((k) => k !== ''));

const SYMBOLS = [
  { name: 'submitTask', file: 'src/main/core/engine.js', line: 42, signature: 'async submitTask(ctx, input) → Result<TaskRecord>' },
  { name: 'tickSite', file: 'src/main/core/engine.js', line: 96, signature: 'async tickSite(ctx, siteId, onChunk) → Result' },
  { name: 'approveTask', file: 'src/main/core/engine.js', line: 171, signature: 'async approveTask(ctx, { taskId, decision })' },
  { name: 'selectSite', file: 'src/main/core/scheduler.js', line: 28, signature: 'selectSite({ skillId, candidates }) → Result' },
  { name: 'enqueue', file: 'src/main/core/site-queue.js', line: 31, signature: 'enqueue(siteId, job) → Result' },
  { name: 'applyPatch', file: 'src/main/git/patch-pipeline.js', line: 82, signature: 'apply({ worktreePath, diff }) → Result' },
  { name: 'runRound', file: 'src/main/core/conference/round-runner.js', line: 22, signature: 'async runRound({ participants, prompt, send })' },
  { name: 'compose', file: 'src/main/core/model-io/prompt-composer.js', line: 38, signature: 'compose(input) → { text, sections }' },
  { name: 'formatChatTime', file: 'src/ui/utils/time.js', line: 9, signature: 'formatChatTime(iso, now?) → string' },
  { name: 'groupConversations', file: 'src/ui/utils/chat-group.js', line: 12, signature: 'groupConversations(list, size=10)' },
];

const MODELS = [
  { id: 'deepseek', name: 'DeepSeek', color: '#4f8cff', online: true },
  { id: 'doubao', name: '豆包', color: '#22c1a4', online: true },
  { id: 'kimi', name: 'Kimi', color: '#f2b13c', online: true },
  { id: 'qwen', name: '通义千问', color: '#a06cff', online: true },
  { id: 'zhipu', name: '智谱清言', color: '#ff7a59', online: false },
];

/** 158 条历史，验证"分组 + 虚拟滚动 + 进度条" */
let SEQ = 0;
const CONVERSATIONS = Array.from({ length: 158 }, (_, i) => {
  SEQ += 1;
  const model = MODELS[i % MODELS.length];
  const topics = ['修复空指针', '补 B6 测试', '方案评审', '依赖方向纠偏', '重构 tab 布局', '检查器输出解析', '命令票据失效排查', '对话历史聚合'];
  const minutesAgo = (158 - i) * 47;
  return {
    id: `cnv_${String(SEQ).padStart(4, '0')}`,
    title: `${topics[i % topics.length]} #${SEQ}`,
    modelId: model.id,
    createdAt: ago(minutesAgo + 30),
    updatedAt: ago(minutesAgo),
    messages: [
      { role: 'user', text: `第 ${SEQ} 次：${topics[i % topics.length]}，帮我看下。`, ts: ago(minutesAgo + 30) },
      { role: 'assistant', text: `结论：${topics[i % topics.length]} 已处理，关键改动见 patch。`, ts: ago(minutesAgo) },
    ],
  };
});

const OPEN_FILES = [
  { path: 'src/main/core/engine.js', lang: 'javascript' },
  { path: 'src/ui/App.vue', lang: 'html' },
  { path: 'src/main/git/patch-pipeline.js', lang: 'javascript' },
];

const CONTENTS = {
  'src/main/core/engine.js': `export class Engine {
  constructor(deps) {
    this.deps = deps;
    this.scheduler = deps.scheduler;
    this.runner = deps.runner;
    this.machine = deps.machine;
    this.store = deps.store;
  }

  async submitTask(ctx, input) {
    const site = this.scheduler.selectSite({ skillId: input.skillId, candidates: input.candidates });
    if (!site.ok) return site;
    const task = this.machine.create({ skillId: input.skillId, prompt: input.prompt, siteId: site.value.id });
    await this.store.saveTask(task);
    return ok({ taskId: 'tsk_0011aabb', state: 'queued' });
  }

  async tickSite(ctx, siteId, onChunk) {
    const job = this.store.nextJob(siteId);
    if (!job) return ok({ idle: true });
    const res = await this.runner.sendTask({ siteId, prompt: job.prompt, onChunk, traceId: ctx.traceId });
    if (!res.ok) return this.retry(ctx, job, res.error);
    return this.store.markDone(job.id, res.value);
  }

  async retry(ctx, job, error) {
    const limit = this.deps.config.get('retry.limit', 2);
    if (job.attempts >= limit) return err('E_RETRY_LIMIT', error?.message);
    await this.store.bumpAttempt(job.id);
    return ok({ requeued: job.id, attempts: job.attempts + 1 });
  }

  async approveTask(ctx, { taskId, decision }) {
    const task = await this.store.getTask(taskId);
    if (!task.ok) return task;
    if (decision === 'reject') return this.machine.reject(task.value);
    const patch = this.deps.patches.apply({ worktreePath: task.value.worktreePath, diff: task.value.diff });
    if (!patch.ok) return patch;
    return this.machine.approve(task.value, patch.value);
  }

  async conference(ctx, taskIds) {
    const rounds = await this.deps.conference.runRound({ participants: taskIds });
    return rounds.ok ? ok({ tally: this.deps.conference.tally(rounds.value) }) : rounds;
  }

  status() {
    return { queued: this.store.queueSize(), active: this.runner.activeCount() };
  }
}`,
  'src/ui/App.vue': `<template>
  <div class="shell">
    <ActivityBar />
    <Sidebar />
    <EditorArea />
  </div>
</template>`,
  'src/main/git/patch-pipeline.js': `export class PatchPipeline {
  validate({ worktreePath, diff }) {
    if (!/^---\s+\S/.test(diff)) return err('E_PATCH_PARSE', '不是 unified diff');
    return ok({ files: PatchPipeline.parsePaths(diff) });
  }
}`,
};

const TERMINALS = [
  { id: 'term_1', title: 'npm test', lines: ['> herix@0.1.0 test', '> vitest run', '', ' ✓ test/main/core/b6.test.js (17 tests) 14ms', ' Tests  236 passed (236)'], finishedAt: ago(3), exitCode: 0 },
  { id: 'term_2', title: 'npx tsc --noEmit', lines: ['> herix@0.1.0 check', '> tsc --noEmit', ''], finishedAt: ago(9), exitCode: 0 },
];

const OUTPUTS = [
  { id: 'out_1', at: ago(2), text: '构建完成：src/ui/dist（index.html + assets）' },
  { id: 'out_2', at: ago(6), text: 'Chromium 未安装，site.open 将返回 chromium:"missing"' },
];

export const mockApi = {
  appInfo: async () => ({ version: '0.9.0', packaged: false }),
  listDir: async (projectId, dir = '') => {
    const kids = FILE_TREE[dir] ?? [];
    const parent = dir;
    return kids.map((name) => {
      const path = parent ? `${parent}/${name}` : name;
      const isDir = FILE_TREE_DIRS.has(path) || FILE_TREE[path] !== undefined;
      return { name, path, isDir, ext: isDir ? null : (name.split('.').pop() ?? '') };
    });
  },
  expandedDirs: async (projectId) => SEED_EXPANDED[projectId] ?? [],
  saveExpandedDirs: async (projectId, dirs) => ({ ok: true, dirs }),
  search: async (projectId, query, options = {}) => {
    if (!query) return { total: 0, results: [] };
    const flags = options.matchCase ? 'g' : 'gi';
    const re = options.regex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    const results = [];
    for (const [file, body] of Object.entries(CONTENTS)) {
      const lines = body.split('\n');
      lines.forEach((line, i) => {
        if (re.test(line)) results.push({ file, line: i + 1, preview: line.trim().slice(0, 160) });
        re.lastIndex = 0;
      });
    }
    return { total: results.length, results: results.slice(0, 50) };
  },
  gitChanges: async (projectId) => ({
    branch: 'master',
    ahead: 0,
    changes: [
      { path: 'src/ui/App.vue', status: 'M' },
      { path: 'src/main/bootstrap.js', status: 'M' },
      { path: 'src/ui/mock-api.js', status: 'A' },
      { path: 'src/renderer/index.html', status: 'D' },
    ],
  }),
  extensions: async () => [
    { id: 'herix.patch-viewer', name: 'Patch Viewer', desc: 'diff 审批与回滚', enabled: true },
    { id: 'herix.symbol-index', name: 'Symbol Index', desc: '函数签名索引（#引用依赖）', enabled: true },
    { id: 'herix.playwright', name: 'Playwright Sites', desc: '站点会话托管', enabled: false },
  ],
  openFiles: async (query) => OPEN_FILES,
  fileContent: async (path) => ({ path, content: CONTENTS[path] ?? `// ${path}\n// （mock 未提供内容）` }),
  symbols: async (query) => {
    const q = String(query ?? '').toLowerCase();
    return SYMBOLS.filter((s) => !q || s.name.toLowerCase().startsWith(q)).slice(0, 8);
  },
  models: async () => MODELS,
  conversations: async () => CONVERSATIONS,
  appendConversation: async (payload) => {
    SEQ += 1;
    const item = {
      id: `cnv_${String(SEQ).padStart(4, '0')}`,
      title: String(payload?.title ?? `新对话 #${SEQ}`).slice(0, 30),
      modelId: payload?.modelId ?? 'doubao',
      createdAt: now(),
      updatedAt: now(),
      messages: [
        { role: 'user', text: String(payload?.prompt ?? ''), ts: now() },
        { role: 'assistant', text: '（原型阶段：模型回复占位）', ts: now() },
      ],
    };
    CONVERSATIONS.unshift(item);
    return item;
  },
  terminals: async () => TERMINALS.map((t) => ({ ...t, clock: formatClock(t.finishedAt) })),
  outputs: async () => OUTPUTS.map((o) => ({ ...o, clock: formatClock(o.at) })),
  copyToClipboard: async (text) => ({ ok: true, text }),
};

// 单文件删除即回到真实 IPC：只改 api/index.js 的 impl 实现
export const __MOCK__ = true;
