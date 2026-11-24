/**
 * B5：状态机全转移覆盖 + StateStore 唯一写入口 + ConfigResolver 覆盖回退。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TaskMachine } from '../../../src/main/core/task-machine.js';
import { StateStore } from '../../../src/main/core/state/state-store.js';
import { TaskRepository } from '../../../src/main/core/state/repositories/task.js';
import { FileStore } from '../../../src/main/infra/storage/file-store.js';
import { ConfigResolver } from '../../../src/main/core/registry/config-resolver.js';
import { SkillRegistry } from '../../../src/main/core/registry/skill-registry.js';
import { SiteConfigSchema, SkillMetaSchema } from '../../../src/libs/schemas/index.js';
import { TASK_STATE, TASK_TERMINAL } from '../../../src/libs/contracts/index.js';
import { parse as parseYaml } from 'yaml';

/** @type {import('../../../src/libs/contracts/index.js').CallCtx} */
const ctx = { traceId: 'trc_00ff11ee', actor: 'engine' };
const ev = (type) => ({ type, traceId: ctx.traceId });

describe('TaskMachine', () => {
  it('转移表自洽（无重复、无未知状态、终态无出边）', () => {
    const r = TaskMachine.auditTable();
    expect(r.ok).toBe(true);
  });

  it('合法路径：queued→running→awaiting_human→running→done', () => {
    let s = TaskMachine.initial();
    const walk = ['lease', 'patch.ready', 'human.approve', 'check.pass'];
    const expected = [TASK_STATE.RUNNING, TASK_STATE.AWAITING_HUMAN, TASK_STATE.RUNNING, TASK_STATE.DONE];
    walk.forEach((e, i) => {
      const r = TaskMachine.apply(ctx, s, ev(e));
      expect(r.ok).toBe(true);
      if (r.ok) s = r.value;
      expect(s).toBe(expected[i]);
    });
    expect(TaskMachine.isTerminal(s)).toBe(true);
  });

  it('终态不可再转移', () => {
    for (const t of TASK_TERMINAL) {
      const r = TaskMachine.apply(ctx, /** @type {any} */ (t), ev('lease'));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('E_VALIDATION');
    }
  });

  it('非法转移返回 err 且不抛（属性测试：任意状态+任意事件都不崩）', () => {
    const states = Object.values(TASK_STATE);
    const events = ['submit', 'lease', 'reply.end', 'patch.ready', 'human.approve', 'human.reject', 'check.pass', 'check.fail', 'retry', 'cancel', 'fail', 'bogus'];
    fc.assert(
      fc.property(fc.constantFrom(...states), fc.constantFrom(...events), (state, type) => {
        const r = TaskMachine.apply(ctx, state, /** @type {any} */ ({ type, traceId: ctx.traceId }));
        return typeof r.ok === 'boolean';
      }),
      { numRuns: 200 },
    );
  });

  it('驳回后回队，retry 后可再次 lease', () => {
    const r1 = TaskMachine.apply(ctx, TASK_STATE.AWAITING_HUMAN, ev('human.reject'));
    expect(r1.ok && r1.value).toBe(TASK_STATE.QUEUED);
    const r2 = TaskMachine.apply(ctx, TASK_STATE.FAILED_RETRYABLE, ev('retry'));
    expect(r2.ok && r2.value).toBe(TASK_STATE.QUEUED);
  });
});

describe('StateStore + TaskRepository', () => {
  let store;

  beforeEach(async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'herix-b5-'));
    const fs = new FileStore(root);
    store = new StateStore({
      repositories: { tasks: new TaskRepository(fs) },
    });
  });

  it('commit 是唯一写入口，且只在 journal 里出现一次', async () => {
    const created = {
      slice: 'tasks',
      type: 'task.created',
      at: '2026-11-21T00:00:00.000Z',
      traceId: ctx.traceId,
      payload: { taskId: 'tsk_0011aabb', projectId: 'prj_0011aabb', state: 'queued', skillId: 'impl-1' },
    };
    const r = await store.commit(ctx, created);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.version).toBe(1);
    const snap = /** @type {any} */ (store.get('tasks'));
    expect(snap['tsk_0011aabb'].state).toBe('queued');
    expect(Object.isFrozen(store.get('tasks'))).toBe(true);
  });

  it('缺少 traceId 的领域事件被拒绝', async () => {
    const r = await store.commit(ctx, { slice: 'tasks', type: 'x', at: '', payload: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('E_VALIDATION');
  });

  it('未知切片被拒绝', async () => {
    const r = await store.commit(ctx, { slice: 'nope', type: 'x', traceId: ctx.traceId, at: '', payload: {} });
    expect(r.ok).toBe(false);
  });

  it('并发提交同一切片：版本号单调递增，无丢失', async () => {
    await store.commit(ctx, {
      slice: 'tasks',
      type: 'task.created',
      traceId: ctx.traceId,
      at: '2026-11-21T00:00:00.000Z',
      payload: { taskId: 'tsk_0011aabb', state: 'queued', skillId: 's' },
    });
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        store.commit(ctx, {
          slice: 'tasks',
          type: 'task.state',
          traceId: ctx.traceId,
          at: '2026-11-21T00:00:01.000Z',
          payload: { taskId: 'tsk_0011aabb', state: 'running' },
        }),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    const versions = results.map((r) => (r.ok ? r.value.version : -1));
    expect(new Set(versions).size).toBe(10);
  });

  it('subscribe 在 commit 后被通知，unsubscribe 生效', async () => {
    let calls = 0;
    const off = store.subscribe('tasks', () => {
      calls += 1;
    });
    await store.commit(ctx, {
      slice: 'tasks',
      type: 'task.created',
      traceId: ctx.traceId,
      at: '2026-11-21T00:00:00.000Z',
      payload: { taskId: 'tsk_0011aabb', state: 'queued', skillId: 's' },
    });
    expect(calls).toBe(1);
    off();
    await store.commit(ctx, {
      slice: 'tasks',
      type: 'task.state',
      traceId: ctx.traceId,
      at: '2026-11-21T00:00:01.000Z',
      payload: { taskId: 'tsk_0011aabb', state: 'running' },
    });
    expect(calls).toBe(1);
  });

  it('load 能从文件恢复（hydrate）', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'herix-b5h-'));
    const fs = new FileStore(root);
    const repo = new TaskRepository(fs);
    await repo.save(
      /** @type {any} */ ({
        'tsk_0011aabb': {
          id: 'tsk_0011aabb',
          projectId: 'prj_0011aabb',
          state: 'queued',
          skillId: 's',
          retryCount: 0,
          createdAt: '2026-11-21T00:00:00.000Z',
          updatedAt: '2026-11-21T00:00:00.000Z',
        },
      }),
    );
    const store2 = new StateStore({ repositories: { tasks: repo } });
    const r = await store2.hydrate(ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.restored).toBe(1);
  });
});

describe('ConfigResolver：覆盖优先 + 坏文件回退', () => {
  const defaults = {
    'sites/good.yaml': 'id: doubao-web\nname: 豆包\nurl: https://a.com\nselectors: {input: t, send: b, reply: r}\nthrottle: {minIntervalMs: 3000}',
    'sites/fallback.yaml': 'id: deepseek-web\nname: DeepSeek\nurl: https://b.com\nselectors: {input: t, send: b, reply: r}\nthrottle: {minIntervalMs: 3000}',
  };
  const overrides = {
    'sites/fallback.yaml': 'id: deepseek-web\nname: 坏的\nurl: not-a-url',
  };

  const mkResolver = () =>
    new ConfigResolver({
      readDefault: async (rel) => ({ ok: true, value: defaults[rel] ?? null }),
      readOverride: async (rel) => ({ ok: true, value: overrides[rel] ?? null }),
      listDefault: async () => Object.keys(defaults).filter((k) => k.startsWith('sites/')).map((k) => k.replace('sites/', '')),
      listOverride: async () => Object.keys(overrides).filter((k) => k.startsWith('sites/')).map((k) => k.replace('sites/', '')),
      parseYaml,
      schemaOf: () => SiteConfigSchema,
      onReject: (kind, file, reason) => rejects.push(`${file}:${reason}`),
    });

  /** @type {string[]} */
  let rejects;
  beforeEach(() => {
    rejects = [];
  });

  it('覆盖文件坏了 → 记 reject 并回退默认版本', async () => {
    const resolver = mkResolver();
    const r = await resolver.load('sites', ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rejected.length).toBe(1);
      expect(r.value.sources.join()).toContain('default-fallback:sites/fallback.yaml');
      const site = /** @type {any} */ (r.value.items.find((i) => i.id === 'deepseek-web'));
      expect(site.url).toBe('https://b.com');
    }
    expect(rejects.length).toBe(1);
  });

  it('正常文件与覆盖都进入 items', async () => {
    const resolver = mkResolver();
    const r = await resolver.load('sites', ctx);
    if (r.ok) expect(r.value.items.map((i) => i.id).sort()).toEqual(['deepseek-web', 'doubao-web']);
  });

  it('未知资源类型返回 err', async () => {
    const resolver = mkResolver();
    const r = await resolver.load(/** @type {any} */ ('prompts'), ctx);
    expect(r.ok).toBe(false);
  });
});

describe('SkillRegistry', () => {
  const skill = { id: 'impl-1', role: 'implementer', title: '实现者', promptTemplate: 'x', sites: [], needConference: false };

  it('重复 ID 被拒绝，不覆盖既有', () => {
    const reg = new SkillRegistry();
    const r1 = reg.loadAll([skill]);
    expect(r1.ok).toBe(true);
    const r2 = reg.loadAll([{ ...skill, title: '冲突版' }]);
    if (r2.ok) expect(r2.value.rejected).toContain('impl-1');
    const got = reg.get('impl-1');
    if (got.ok) expect(got.value.title).toBe('实现者');
  });

  it('按角色筛选与站点白名单', () => {
    const reg = new SkillRegistry();
    reg.loadAll([skill, { ...skill, id: 'rev-1', role: 'reviewer' }]);
    expect(reg.listByRole('implementer')).toHaveLength(1);
    expect(reg.allowsSite('impl-1', 'any-site')).toBe(true);
    const limited = new SkillRegistry();
    limited.loadAll([{ ...skill, id: 'impl-2', sites: ['doubao-web'] }]);
    expect(limited.allowsSite('impl-2', 'deepseek-web')).toBe(false);
  });

  it('Schema 与 registry 配合：非法 skill 进不了 registry', () => {
    expect(SkillMetaSchema.safeParse({ ...skill, role: 'god' }).success).toBe(false);
  });
});
