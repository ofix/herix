/**
 * SiteQueue：每站点 FIFO + 单会话互斥 + 原子预留。
 * 铁律：一个站点同一时刻最多一个会话。预留（会议）走 reserveAll —— 全有或全无，避免死锁。
 * @module main/core/site-queue
 */
import { ok, err } from '../../libs/utils/result.js';
import { ERROR_CODE } from '../../libs/utils/errors.js';

/** @template T @typedef {import('../../libs/utils/result.js').Result<T>} Result */

/** @typedef {{ taskId: string, skillId: string, enqueuedAt: number, priority: number }} QueueItem */

export class SiteQueue {
  /**
   * @param {{ maxQueue?: number, clock?: () => number }} [opts]
   */
  constructor(opts = {}) {
    this.maxQueue = opts.maxQueue ?? 50;
    this.clock = opts.clock ?? (() => Date.now());
    /** @type {Map<string, QueueItem[]>} */
    this.queues = new Map();
    /** @type {Map<string, { taskId: string, reservedBy?: string }>} 当前占用者 */
    this.leaseHolder = new Map();
    /** @type {Map<string, string>} siteId → 预留下会议 ID */
    this.reservations = new Map();
  }

  /**
   * @param {string} siteId
   * @param {{ taskId: string, skillId: string, priority?: number }} item
   * @returns {Result<{ position: number }>}
   */
  enqueue(siteId, item) {
    const q = this.queues.get(siteId) ?? [];
    if (q.length >= this.maxQueue) {
      return err(ERROR_CODE.VALIDATION, `站点 ${siteId} 队列已满（${this.maxQueue}）`, { retryable: true });
    }
    if (q.some((i) => i.taskId === item.taskId)) {
      return err(ERROR_CODE.VALIDATION, `任务 ${item.taskId} 已在站点 ${siteId} 队列中`);
    }
    q.push({ ...item, priority: item.priority ?? 5, enqueuedAt: this.clock() });
    // 优先级高在前，同优先级 FIFO（保证不饿死：enqueuedAt 作为次序）
    q.sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt);
    this.queues.set(siteId, q);
    return ok({ position: q.findIndex((i) => i.taskId === item.taskId) });
  }

  /** @param {string} siteId @returns {boolean} */
  isBusy(siteId) {
    return this.leaseHolder.has(siteId) || this.reservations.has(siteId);
  }

  /**
   * 取下一个可执行任务并占用站点。
   * @param {string} siteId
   * @returns {Result<QueueItem>}
   */
  lease(siteId) {
    if (this.reservations.has(siteId)) {
      return err(ERROR_CODE.VALIDATION, `站点 ${siteId} 已被会议预留`, { retryable: true });
    }
    if (this.leaseHolder.has(siteId)) {
      return err(ERROR_CODE.VALIDATION, `站点 ${siteId} 正在被 ${this.leaseHolder.get(siteId)?.taskId} 占用`, {
        retryable: true,
      });
    }
    const q = this.queues.get(siteId) ?? [];
    const next = q.shift();
    if (!next) return err(ERROR_CODE.VALIDATION, `站点 ${siteId} 队列为空`);
    this.queues.set(siteId, q);
    this.leaseHolder.set(siteId, { taskId: next.taskId });
    return ok(next);
  }

  /**
   * @param {string} siteId
   * @returns {void}
   */
  release(siteId) {
    this.leaseHolder.delete(siteId);
  }

  /**
   * 原子预留单个站点（会议用）。
   * @param {string} siteId
   * @param {string} confId
   * @returns {Result<void>}
   */
  reserve(siteId, confId) {
    if (this.isBusy(siteId)) {
      return err(ERROR_CODE.CONFERENCE_NO_QUORUM, `站点 ${siteId} 忙，无法预留`, { retryable: true });
    }
    this.reservations.set(siteId, confId);
    return ok(undefined);
  }

  /**
   * 全有或全无：任一站点预留失败则整体回滚。
   * @param {string[]} siteIds
   * @param {string} confId
   * @returns {Result<{ reserved: string[] }>}
   */
  reserveAll(siteIds, confId) {
    const done = [];
    for (const id of siteIds) {
      const r = this.reserve(id, confId);
      if (!r.ok) {
        for (const d of done) this.reservations.delete(d);
        return err(ERROR_CODE.CONFERENCE_NO_QUORUM, `会议 ${confId} 预留失败于 ${id}，已回滚 ${done.length} 个`, {
          retryable: true,
        });
      }
      done.push(id);
    }
    return ok({ reserved: done });
  }

  /** @param {string} siteId */
  releaseReservation(siteId) {
    this.reservations.delete(siteId);
  }

  /** @param {string} siteId @returns {number} */
  size(siteId) {
    return (this.queues.get(siteId) ?? []).length;
  }

  /** @returns {{ siteId: string, depth: number, busy: boolean }[]} */
  snapshot() {
    return [...this.queues.entries()].map(([siteId, q]) => ({
      siteId,
      depth: q.length,
      busy: this.isBusy(siteId),
    }));
  }
}
