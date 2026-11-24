/**
 * Engine：唯一对外编排入口。它不写状态机规则、不碰文件、不发帧 —— 只按顺序调用协作者。
 * B6 版只负责：提交任务 → 选站 → 入队 → 下发 → 收口。模型输出解析（B7）通过 runner 注入。
 * @module main/core/engine
 */
import crypto from 'node:crypto';
import { ok, err } from '../../libs/utils/result.js';
import { ERROR_CODE } from '../../libs/utils/errors.js';
import { TASK_STATE } from '../../libs/contracts/domain.js';
import { TaskMachine } from './task-machine.js';

/** @template T @typedef {import('../../libs/utils/result.js').Result<T>} Result */
/** @typedef {import('../../libs/contracts/index.js').CallCtx} CallCtx */

const hex8 = () => crypto.randomBytes(4).toString('hex');
const newTaskId = () => `tsk_${hex8()}`;

export class Engine {
  /**
   * @param {object} deps
   * @param {import('./state/state-store.js').StateStore} deps.stateStore
   * @param {import('./scheduler.js').Scheduler} deps.scheduler
   * @param {import('./site-queue.js').SiteQueue} deps.siteQueue
   * @param {{ sendTask: (args: any) => Promise<any> }} [deps.runner] 真实为 PlaywrightBridge
   * @param {(siteId: string) => any} [deps.siteHealth] 返回站点健康度
   * @param {import('./registry/skill-registry.js').SkillRegistry} [deps.skills]
   * @param {() => number} [deps.clock]
   */
  constructor({ stateStore, scheduler, siteQueue, runner, siteHealth, skills, clock }) {
    this.stateStore = stateStore;
    this.scheduler = scheduler;
    this.siteQueue = siteQueue;
    this.runner = runner;
    this.siteHealth = siteHealth ?? (() => null);
    this.skills = skills;
    this.clock = clock ?? (() => Date.now());
    /** 幂等：idempotencyKey → taskId */
    this.idem = new Map();
  }

  /**
   * @param {CallCtx} ctx
   * @param {object} input TaskInput
   * @returns {Promise<Result<{ taskId: string, state: string, siteId?: string }>>}
   */
  async submitTask(ctx, input) {
    const idemKey = ctx.idempotencyKey;
    if (idemKey && this.idem.has(idemKey)) {
      return ok({ taskId: /** @type {string} */ (this.idem.get(idemKey)), state: TASK_STATE.QUEUED });
    }
    if (!input?.skillId || !input?.prompt) {
      return err(ERROR_CODE.VALIDATION, 'skillId 与 prompt 必填', { traceId: ctx.traceId });
    }

    // 1) 选站：白名单来自 SKILL，健康度来自外部
    /** @type {any[]} */
    let allowed = [];
    if (this.skills) {
      const s = this.skills.get(input.skillId);
      if (!s.ok) return s;
      allowed = [...(s.value.sites ?? [])];
    }
    const ranked = this.scheduler.rankSites({
      skillId: input.skillId,
      candidates: input.candidates ?? [],
      allowedSites: allowed,
    });
    if (!ranked.ok) return ranked;

    const siteId = ranked.value[0];
    const taskId = newTaskId();
    const at = new Date(this.clock()).toISOString();

    // 2) 落状态（唯一写入口）
    const created = await this.stateStore.commit(ctx, {
      slice: 'tasks',
      type: 'task.created',
      at,
      traceId: ctx.traceId,
      payload: {
        taskId,
        projectId: input.projectId,
        state: TASK_STATE.QUEUED,
        skillId: input.skillId,
        siteId,
        prompt: input.prompt,
        createdAt: at,
        updatedAt: at,
      },
    });
    if (!created.ok) return created;

    // 3) 入队
    const enq = this.siteQueue.enqueue(siteId, { taskId, skillId: input.skillId, priority: input.priority });
    if (!enq.ok) return enq;

    if (idemKey) this.idem.set(idemKey, taskId);
    return ok({ taskId, state: TASK_STATE.QUEUED, siteId });
  }

  /**
   * 推进站点队列：能租到就下发一轮。
   * @param {CallCtx} ctx
   * @param {string} siteId
   * @param {(chunk: string) => void} [onChunk]
   * @returns {Promise<Result<{ taskId: string, text: string }>>}
   */
  async tickSite(ctx, siteId, onChunk = () => {}) {
    const leased = this.siteQueue.lease(siteId);
    if (!leased.ok) return leased;
    const { taskId } = leased.value;

    const moved = await this.applyEvent(ctx, taskId, { type: 'lease' });
    if (!moved.ok) {
      this.siteQueue.release(siteId);
      return moved;
    }

    if (!this.runner) {
      this.siteQueue.release(siteId);
      return err(ERROR_CODE.WORKER_DOWN, 'runner 未注入', { traceId: ctx.traceId, retryable: true });
    }

    const task = /** @type {any} */ (this.stateStore.get('tasks'))[taskId];
    const run = await this.runner.sendTask({
      siteId,
      prompt: task?.prompt ?? '',
      onChunk,
      traceId: ctx.traceId,
    });

    if (!run.ok) {
      await this.applyEvent(ctx, taskId, { type: 'fail', reason: run.error.message });
      this.siteQueue.release(siteId);
      this.siteQueue.enqueue(siteId, { taskId, skillId: task?.skillId ?? 'unknown', priority: 9 });
      return run;
    }

    await this.applyEvent(ctx, taskId, { type: 'reply.end' });
    this.siteQueue.release(siteId);
    return ok({ taskId, text: String(run.value?.payload?.text ?? '') });
  }

  /**
   * @param {CallCtx} ctx
   * @param {string} taskId
   * @param {any} event
   * @returns {Promise<Result<{ state: string }>>}
   */
  async applyEvent(ctx, taskId, event) {
    const rec = /** @type {any} */ (this.stateStore.get('tasks'))[taskId];
    if (!rec) return err(ERROR_CODE.VALIDATION, `任务不存在: ${taskId}`, { traceId: ctx.traceId });
    const next = TaskMachine.apply(ctx, rec.state, { ...event, taskId });
    if (!next.ok) return next;
    const at = new Date(this.clock()).toISOString();
    const r = await this.stateStore.commit(ctx, {
      slice: 'tasks',
      type: `task.${event.type}`,
      at,
      traceId: ctx.traceId,
      payload: { taskId, state: next.value },
    });
    return r.ok ? ok({ state: next.value }) : r;
  }

  /**
   * 人工审批入口。
   * @param {CallCtx} ctx
   * @param {{ taskId: string, decision: 'approve'|'reject', reason?: string, scope?: string }} args
   */
  async approveTask(ctx, { taskId, decision, reason, scope = 'single' }) {
    const eventType = decision === 'approve' ? 'human.approve' : 'human.reject';
    const r = await this.applyEvent(ctx, taskId, { type: eventType, reason, scope });
    if (!r.ok) return r;
    // 驳回回队重做
    if (decision === 'reject') {
      const rec = /** @type {any} */ (this.stateStore.get('tasks'))[taskId];
      this.siteQueue.enqueue(rec?.siteId ?? '', { taskId, skillId: rec?.skillId ?? 'unknown', priority: 9 });
    }
    return r;
  }

  /** @returns {{ tasks: any, queues: any, version: number }} */
  getSnapshot() {
    return { tasks: this.stateStore.get('tasks'), queues: this.siteQueue.snapshot(), version: 1 };
  }
}
