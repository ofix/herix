/**
 * B6：站点队列互斥/预留回滚、选站策略、Engine 编排（用 fake runner，不启浏览器）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SiteQueue } from '../../../src/main/core/site-queue.js';
import { Scheduler } from '../../../src/main/core/scheduler.js';
import { Engine } from '../../../src/main/core/engine.js';
import { StateStore } from '../../../src/main/core/state/state-store.js';
import { TaskRepository } from '../../../src/main/core/state/repositories/task.js';
import { SkillRegistry } from '../../../src/main/core/registry/skill-registry.js';
import { TASK_STATE } from '../../../src/libs/contracts/index.js';

/** @type {import('../../../src/libs/contracts/index.js').CallCtx} */
const ctx = { traceId: 'trc_00ff11ee', actor: 'engine' };

describe('SiteQueue', () => {
  it('同站点严格串行：占用中再 lease 被拒', () => {
    const q = new SiteQueue({ clock: () => 0 });
    q.enqueue('s1', { taskId: 'tsk_0011aabb', skillId: 'a' });
    const first = q.lease('s1');
    expect(first.ok).toBe(true);
    const second = q.lease('s1');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('E_VALIDATION');
    q.release('s1');
    const third = q.lease('s1');
    expect(third.ok).toBe(false); // 队列已空
  });

  it('按优先级出队，同优先级 FIFO', () => {
    const q = new SiteQueue({ clock: () => 0 });
    q.enqueue('s1', { taskId: 'tsk_00000001', skillId: 'a', priority: 5 });
    q.enqueue('s1', { taskId: 'tsk_00000002', skillId: 'a', priority: 9 });
    q.enqueue('s1', { taskId: 'tsk_00000003', skillId: 'a', priority: 5 });
    const first = q.lease('s1');
    expect(first.ok && first.value.taskId).toBe('tsk_00000001');
  });

  it('重复入队被拒（幂等）', () => {
    const q = new SiteQueue();
    q.enqueue('s1', { taskId: 'tsk_0011aabb', skillId: 'a' });
    const again = q.enqueue('s1', { taskId: 'tsk_0011aabb', skillId: 'a' });
    expect(again.ok).toBe(false);
  });

  it('reserveAll 全有或全无：一个失败则整体回滚', () => {
    const q = new SiteQueue();
    q.enqueue('s2', { taskId: 'tsk_0011aabb', skillId: 'a' });
    q.lease('s2');
    const r = q.reserveAll(['s1', 's2', 's3'], 'cnf_0011aabb');
    expect(r.ok).toBe(false);
    expect(q.reservations.size).toBe(0); // 已回滚
  });

  it('预留期间 lease 被拒，释放后恢复', () => {
    const q = new SiteQueue();
    expect(q.reserve('s1', 'cnf_0011aabb').ok).toBe(true);
    q.enqueue('s1', { taskId: 'tsk_0011aabb', skillId: 'a' });
    expect(q.lease('s1').ok).toBe(false);
    q.releaseReservation('s1');
    expect(q.lease('s1').ok).toBe(true);
  });

  it('队列上限', () => {
    const q = new SiteQueue({ maxQueue: 1 });
    q.enqueue('s1', { taskId: 'tsk_00000001', skillId: 'a' });
    const r = q.enqueue('s1', { taskId: 'tsk_00000002', skillId: 'a' });
    expect(r.ok).toBe(false);
  });
});

describe('Scheduler', () => {
  const health = (id, over = {}) => ({ id, state: 'available', queueDepth: 0, ...over });

  it('优先选队列最短的站点', () => {
    const s = new Scheduler();
    const r = s.selectSite({ skillId: 'x', candidates: [health('a', { queueDepth: 3 }), health('b', { queueDepth: 1 })] });
    expect(r.ok && r.value.siteId).toBe('b');
  });

  it('熔断站点被排除（连续失败 >= 3）', () => {
    const s = new Scheduler();
    const r = s.selectSite({
      skillId: 'x',
      candidates: [health('a', { failureStreak: 3 }), health('b', { queueDepth: 5 })],
    });
    expect(r.ok && r.value.siteId).toBe('b');
    expect(s.shouldCircuitBreak('a', health('a', { failureStreak: 3 }))).toBe(true);
  });

  it('冷却未到期站点被排除', () => {
    const s = new Scheduler({ clock: () => Date.parse('2026-11-21T00:00:00Z') });
    const r = s.selectSite({
      skillId: 'x',
      candidates: [health('a', { cooldownUntil: '2026-11-21T00:10:00Z' }), health('b')],
    });
    expect(r.ok && r.value.siteId).toBe('b');
  });

  it('全部不可用返回 err，且不抛', () => {
    const s = new Scheduler();
    const r = s.selectSite({ skillId: 'x', candidates: [health('a', { state: 'unavailable' })] });
    expect(r.ok).toBe(false);
  });

  it('白名单只允许指定站点', () => {
    const s = new Scheduler();
    const r = s.selectSite({ skillId: 'x', candidates: [health('a'), health('b')], allowedSites: ['b'] });
    expect(r.ok && r.value.siteId).toBe('b');
  });
});

describe('Engine（fake runner）', () => {
  /** @type {Engine} */
  let engine;
  /** @type {any[]} */
  let sent;

  beforeEach(async () => {
    const fs = /** @type {any} */ ({
      readText: async () => ({ ok: true, value: null }),
      writeTextAtomic: async () => ({ ok: true, value: { bytes: 1 } }),
      appendLine: async () => ({ ok: true, value: { bytes: 1 } }),
      list: async () => ({ ok: true, value: [] }),
    });
    const store = new StateStore({ repositories: { tasks: new TaskRepository(fs) } });
    const skills = new SkillRegistry();
    skills.loadAll([{ id: 'impl-1', role: 'implementer', title: '实现', promptTemplate: 'p', sites: ['s1'], needConference: false }]);
    sent = [];
    engine = new Engine({
      stateStore: store,
      scheduler: new Scheduler(),
      siteQueue: new SiteQueue(),
      runner: {
        sendTask: async (args) => {
          sent.push(args);
          return { ok: true, value: { type: 'reply.end', payload: { text: '模型回复' } } };
        },
      },
      skills,
      clock: () => Date.parse('2026-11-21T00:00:00Z'),
    });
  });

  const input = (over = {}) => ({
    projectId: 'prj_0011aabb',
    skillId: 'impl-1',
    prompt: '帮我改 bug',
    priority: 5,
    candidates: [{ id: 's1', state: 'available', queueDepth: 0 }],
    ...over,
  });

  it('submitTask 落状态并入队，返回 queued', async () => {
    const r = await engine.submitTask(ctx, input());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.state).toBe(TASK_STATE.QUEUED);
      expect(r.value.taskId).toMatch(/^tsk_[0-9a-f]{8}$/);
      expect(engine.getSnapshot().queues[0].depth).toBe(1);
    }
  });

  it('幂等键重复提交返回同一 taskId', async () => {
    const c1 = { ...ctx, idempotencyKey: 'idem_abcdefgh' };
    const a = await engine.submitTask(c1, input());
    const b = await engine.submitTask(c1, input());
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value.taskId).toBe(b.value.taskId);
  });

  it('无候选站点时返回 err', async () => {
    const r = await engine.submitTask(ctx, input({ candidates: [] }));
    expect(r.ok).toBe(false);
  });

  it('tickSite 走完 queued→running→（reply.end）并释放站点', async () => {
    const sub = await engine.submitTask(ctx, input());
    const taskId = /** @type {any} */ (sub).value.taskId;
    const chunks = [];
    const r = await engine.tickSite(ctx, 's1', (c) => chunks.push(c));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('模型回复');
    const rec = /** @type {any} */ (engine.getSnapshot().tasks)[taskId];
    expect(rec.state).toBe(TASK_STATE.RUNNING);
    expect(engine.getSnapshot().queues[0].busy).toBe(false);
    expect(sent[0].prompt).toBe('帮我改 bug');
  });

  it('runner 失败 → 任务转 failed_retryable 并回队', async () => {
    const sub = await engine.submitTask(ctx, input());
    const taskId = /** @type {any} */ (sub).value.taskId;
    engine.runner = { sendTask: async () => ({ ok: false, error: { code: 'E_TIMEOUT', message: '超时' } }) };
    const r = await engine.tickSite(ctx, 's1');
    expect(r.ok).toBe(false);
    const rec = /** @type {any} */ (engine.getSnapshot().tasks)[taskId];
    expect(rec.state).toBe(TASK_STATE.FAILED_RETRYABLE);
    expect(engine.getSnapshot().queues[0].depth).toBe(1);
  });

  it('非法决策（不存在的任务）返回 err', async () => {
    const r = await engine.approveTask(ctx, { taskId: 'tsk_ffffffff', decision: 'approve' });
    expect(r.ok).toBe(false);
  });
});
