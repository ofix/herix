/**
 * B9b：渲染层。Electron/浏览器都不在依赖里，所以测"能测的部分"：
 * api 注入与错误归一化、任务状态 composable、路由解析、诊断格式化、CSP 与入口引用完整性。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createApi, api } from '../../src/renderer/src/api/index.js';
import { createTaskStore, groupByState } from '../../src/renderer/src/composables/useTasks.js';
import { parseHash, toHash, watchRoute, ROUTES } from '../../src/renderer/src/router/route.js';
import { createAppStore } from '../../src/renderer/src/stores/app-store.js';
import { formatDiagnostic, renderDiagnostics } from '../../src/renderer/src/components/diagnostic-list.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

/** 假 bridge：按调用记录并返回预置值 */
function fakeBridge() {
  const calls = [];
  const mk = (name, value) => (...args) => {
    calls.push({ name, args });
    return Promise.resolve(typeof value === 'function' ? value(...args) : value);
  };
  return {
    calls,
    app: { info: mk('app.info', { version: '1' }) },
    state: { snapshot: mk('state.snapshot', { tasks: { tsk_0011aabb: { state: 'queued' } }, queues: [] }) },
    task: { submit: mk('task.submit', { taskId: 'tsk_0011aabb' }), approve: mk('task.approve', { state: 'running' }) },
    site: { list: mk('site.list', []), tick: mk('site.tick', {}) },
    project: { open: mk('project.open', {}), close: mk('project.close', {}) },
    check: { run: mk('check.run', { pass: true }) },
    command: { approve: mk('command.approve', {}), pending: mk('command.pending', []) },
    capabilities: { channels: ['app:info'] },
  };
}

describe('api 层', () => {
  it('无 bridge 时抛明确错误', () => {
    expect(() => createApi(undefined)).toThrow(/preload/);
  });

  it('各方法转到对应 bridge 方法', async () => {
    const b = fakeBridge();
    const a = createApi(b);
    await a.info();
    await a.submitTask({ prompt: 'x' });
    await a.approveTask({ taskId: 'tsk_0011aabb', decision: 'approve' });
    expect(b.calls.map((c) => c.name)).toEqual(['app.info', 'task.submit', 'task.approve']);
  });

  it('bridge 抛错误时归一成 ApiError（保留 code/traceId）', async () => {
    const b = fakeBridge();
    b.task.submit = () => {
      const e = new Error('校验失败');
      /** @type {any} */ (e).code = 'E_VALIDATION';
      /** @type {any} */ (e).traceId = 'trc_x';
      return Promise.reject(e);
    };
    const a = createApi(b);
    await expect(a.submitTask({})).rejects.toMatchObject({ code: 'E_VALIDATION', traceId: 'trc_x' });
  });

  it('无 preload 环境下默认 api 仍可 import 且调用会报 E_NO_BRIDGE', async () => {
    await expect(api.info()).rejects.toMatchObject({ code: 'E_NO_BRIDGE' });
    expect(api.capabilities.channels.length).toBeGreaterThan(0);
  });
});

describe('useTasks', () => {
  const mkStore = () => {
    const calls = [];
    const store = createTaskStore({
      snapshot: async () => ({ tasks: { tsk_0011aabb: { taskId: 'tsk_0011aabb', state: 'queued', updatedAt: '2026-11-21T00:00:00Z' } }, queues: [{ siteId: 's1', depth: 1 }] }),
      submitTask: async (i) => {
        calls.push(['submit', i]);
        return { taskId: 'tsk_0011aabb' };
      },
      approveTask: async (i) => {
        calls.push(['approve', i]);
        return { state: 'running' };
      },
    });
    return { store, calls };
  };

  it('refresh 填入 tasks/queues 并清空 error', async () => {
    const { store } = mkStore();
    await store.refresh();
    expect(Object.keys(store.state.tasks)).toEqual(['tsk_0011aabb']);
    expect(store.state.queue).toHaveLength(1);
    expect(store.state.error).toBeNull();
    expect(store.state.loading).toBe(false);
  });

  it('submit 后自动 refresh', async () => {
    const { store, calls } = mkStore();
    await store.submit({ prompt: 'x' });
    expect(calls[0][0]).toBe('submit');
    expect(store.state.lastSyncAt).toBeGreaterThan(0);
    expect(store.state.pending.submit).toBe(false);
  });

  it('decide 记录瞬时 pending 并在结束后清除', async () => {
    const { store } = mkStore();
    const p = store.decide('tsk_0011aabb', 'approve');
    await p;
    expect(store.state.pending.tsk_0011aabb).toBeUndefined();
  });

  it('错误被捕获到 state.error，不抛', async () => {
    const store = createTaskStore({
      snapshot: async () => {
        const e = new Error('挂了');
        /** @type {any} */ (e).code = 'E_WORKER_DOWN';
        throw e;
      },
      submitTask: async () => {},
      approveTask: async () => {},
    });
    await store.refresh();
    expect(store.state.error?.code).toBe('E_WORKER_DOWN');
  });

  it('subscribe 能收到变化并能退订', async () => {
    const { store } = mkStore();
    let n = 0;
    const off = store.subscribe(() => { n += 1; });
    await store.refresh();
    expect(n).toBeGreaterThan(0);
    off();
    const before = n;
    await store.refresh();
    expect(n).toBe(before);
  });

  it('start/stop 用注入的定时器（可测、不真等）', () => {
    const r = mkStore();
    let registered = 0;
    let cleared = 0;
    const s = createTaskStore({
      snapshot: async () => ({ tasks: {}, queues: [] }),
      submitTask: async () => {},
      approveTask: async () => {},
      setIntervalImpl: (f) => { registered += 1; return 1; },
      clearIntervalImpl: () => { cleared += 1; },
    });
    s.start(100);
    expect(registered).toBe(1);
    s.stop();
    expect(cleared).toBe(1);
    void r;
  });

  it('groupByState 按状态分列并按 updatedAt 倒序', () => {
    const g = groupByState({
      a: { taskId: 'a', state: 'queued', updatedAt: '2026-01-01' },
      b: { taskId: 'b', state: 'queued', updatedAt: '2026-02-01' },
      c: { taskId: 'c', state: 'awaiting_human', updatedAt: '2026-03-01' },
    });
    expect(g.queued.map((x) => x.taskId)).toEqual(['b', 'a']);
    expect(g.awaiting_human).toHaveLength(1);
    expect(g.done).toEqual([]);
  });
});

describe('router', () => {
  it('解析合法路由', () => {
    expect(parseHash('#/tasks')).toEqual({ name: 'tasks', param: null, raw: 'tasks' });
    expect(parseHash('#/project/prj_1')).toEqual({ name: 'project', param: 'prj_1', raw: 'project/prj_1' });
  });

  it('非法/空路径回落 tasks', () => {
    expect(parseHash('#/nope').name).toBe('tasks');
    expect(parseHash('').name).toBe('tasks');
    expect(parseHash('#/').name).toBe('tasks');
  });

  it('toHash 生成规范地址', () => {
    expect(toHash('tasks')).toBe('#/tasks');
    expect(toHash('project', 'p1')).toBe('#/project/p1');
    expect(toHash('bogus')).toBe('#/tasks');
  });

  it('ROUTES 只有三页', () => expect(ROUTES).toEqual(['tasks', 'sites', 'project']));

  it('watchRoute 立即触发一次并能解绑', () => {
    /** @type {Record<string, Function>} */
    const listeners = {};
    /** @type {any} */
    const win = {
      location: { hash: '#/sites' },
      addEventListener: (e, f) => { listeners[e] = f; },
      removeEventListener: (e) => { delete listeners[e]; },
    };
    /** @type {any[]} */
    const got = [];
    const off = watchRoute(win, (r) => got.push(r.name));
    expect(got).toEqual(['sites']);
    off();
    expect(listeners.hashchange).toBeUndefined();
  });
});

describe('app-store', () => {
  it('set/setError/clearError 广播', () => {
    const s = createAppStore();
    let n = 0;
    s.subscribe(() => { n += 1; });
    s.set({ route: 'sites' });
    s.setError({ code: 'E_X', message: '坏了' });
    expect(s.state.banner?.text).toBe('E_X: 坏了');
    s.clearError();
    expect(s.state.banner).toBeNull();
    expect(n).toBe(3);
  });
});

describe('诊断渲染', () => {
  it('formatDiagnostic 带位置与规则号', () => {
    expect(formatDiagnostic({ severity: 'error', file: 'a.ts', line: 3, col: 2, code: 'TS1', message: '坏' }))
      .toBe('× a.ts:3:2 · TS1 · 坏');
    expect(formatDiagnostic({ severity: 'info', code: 'C', message: 'm' })).toContain('全局');
  });

  it('renderDiagnostics 用最小 doc 生成 ul', () => {
    const mkEl = (tag) => /** @type {any} */ ({ tag, children: [], className: '', textContent: '', appendChild(c) { this.children.push(c); } });
    const doc = { createElement: (t) => mkEl(t) };
    const ul = renderDiagnostics(doc, [{ severity: 'warning', code: 'W', message: 'm' }]);
    expect(ul.tag).toBe('ul');
    expect(ul.children).toHaveLength(1);
    expect(ul.children[0].className).toBe('diag diag-warning');
  });
});

describe('渲染资产完整性', () => {
  it('index.html 有 CSP 且禁 inline script，入口指向 main.mjs', () => {
    const html = readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("script-src 'self'");
    expect(html).toContain('type="module" src="./main.mjs"');
  });

  it('入口文件与资源都存在', () => {
    for (const p of ['src/renderer/main.mjs', 'src/renderer/src/assets/app.css', 'src/preload/herix-api.cjs']) {
      expect(existsSync(path.join(ROOT, p))).toBe(true);
    }
  });

  it('renderer 源码不直接引用 window.herix（只有 api 层可以）', () => {
    for (const f of ['src/renderer/main.mjs', 'src/renderer/src/composables/useTasks.js', 'src/renderer/src/views/task-board.js']) {
      const txt = readFileSync(path.join(ROOT, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(txt.includes('window.herix')).toBe(false);
    }
  });

  it('renderer 不 import zod / main 目录', () => {
    for (const f of ['src/renderer/main.mjs', 'src/renderer/src/views/task-board.js', 'src/renderer/src/api/index.js']) {
      const txt = readFileSync(path.join(ROOT, f), 'utf8');
      expect(txt.includes('zod')).toBe(false);
      expect(/from '.*main\//.test(txt)).toBe(false);
    }
  });
});
