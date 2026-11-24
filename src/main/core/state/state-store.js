/**
 * StateStore：唯一持有可变状态的类。所有写操作以 DomainEvent 形式提交。
 * 写路径唯一：commit → slice 串行化 → 校验 → repositories 落盘 → 广播。
 * 其他任何模块都不得直接写 journal / state 文件。
 * @module main/core/state/state-store
 */
import { ok, err } from '../../../libs/utils/result.js';
import { ERROR_CODE } from '../../../libs/utils/errors.js';

/** @template T @typedef {import('../../../libs/utils/result.js').Result<T>} Result */
/** @typedef {import('../../../libs/contracts/index.js').StateSlice} StateSlice */
/** @typedef {import('../../../libs/contracts/index.js').DomainEvent} DomainEvent */
/** @typedef {import('../../../libs/contracts/index.js').CallCtx} CallCtx */

export const SLICES = Object.freeze(['sites', 'projects', 'tasks', 'conferences', 'skills']);

export class StateStore {
  /**
   * @param {object} deps
   * @param {Record<string, import('./repositories/task.js').TaskRepository | any>} deps.repositories 每个切片一个仓库
   * @param {import('../../infra/storage/journal.js').Journal} [deps.journal]
   */
  constructor({ repositories, journal }) {
    this.repositories = repositories;
    this.journal = journal;
    /** @type {Map<string, any>} */
    this.slices = new Map(SLICES.map((s) => [s, {}]));
    this.version = 0;
    /** @type {Map<string, Set<(v:any)=>void>>} */
    this.subs = new Map(SLICES.map((s) => [s, new Set()]));
    /** @type {Map<string, Promise<unknown>>} 切片级串行锁 */
    this.locks = new Map();
  }

  /**
   * 从 repositories 恢复。
   * @param {CallCtx} ctx
   * @returns {Promise<Result<{ restored: number, corrupted: string[] }>>}
   */
  async hydrate(ctx) {
    const restoredList = [];
    const corrupted = [];
    for (const slice of SLICES) {
      const repo = this.repositories[slice];
      if (!repo?.load) continue;
      const r = await repo.load();
      if (r.ok) {
        this.slices.set(slice, r.value);
        restoredList.push(slice);
      } else {
        corrupted.push(slice);
      }
    }
    if (corrupted.length) {
      // 损坏不致命：降级为空态并记审计，不阻断启动
      this.version += 1;
      return ok({ restored: restoredList.length, corrupted });
    }
    void ctx;
    return ok({ restored: restoredList.length, corrupted: [] });
  }

  /**
   * @param {StateSlice} slice
   * @returns {unknown} 冻结快照
   */
  get(slice) {
    return Object.freeze(this.slices.get(slice) ?? {});
  }

  /**
   * @param {string} slice
   * @param {() => Promise<any>} fn
   * @returns {Promise<any>}
   */
  _withLock(slice, fn) {
    const prev = this.locks.get(slice) ?? Promise.resolve();
    const cur = prev.then(fn, fn);
    this.locks.set(
      slice,
      cur.catch(() => {}),
    );
    return cur;
  }

  /**
   * @param {CallCtx} ctx
   * @param {DomainEvent} event
   * @returns {Promise<Result<{ version: number }>>}
   */
  async commit(ctx, event) {
    if (!event || !SLICES.includes(event.slice)) {
      return err(ERROR_CODE.VALIDATION, `未知切片: ${event?.slice}`, { traceId: ctx?.traceId });
    }
    if (!event.type || typeof event.type !== 'string') {
      return err(ERROR_CODE.VALIDATION, '事件缺少 type', { traceId: ctx?.traceId });
    }
    if (!event.traceId) {
      return err(ERROR_CODE.VALIDATION, 'DomainEvent 必须带 traceId', { traceId: ctx?.traceId });
    }

    return this._withLock(event.slice, async () => {
      try {
        const repo = this.repositories[event.slice];
        if (repo?.apply) {
          const r = await repo.apply(this.slices.get(event.slice) ?? {}, event);
          if (!r.ok) return err(r.error.code, r.error.message, { traceId: ctx?.traceId });
          this.slices.set(event.slice, r.value);
        } else {
          const prev = this.slices.get(event.slice) ?? {};
          this.slices.set(event.slice, { ...prev, lastEvent: event.type, lastAt: event.at ?? null });
        }
        this.version += 1;
        if (this.journal) await this.journal.append('tasks', { ...event, version: this.version });
        this._notify(event.slice);
        return ok({ version: this.version });
      } catch (e) {
        return err(ERROR_CODE.STORE_IO, `提交失败: ${/** @type {Error} */ (e).message}`, { traceId: ctx?.traceId });
      }
    });
  }

  /**
   * @param {StateSlice} slice
   * @param {(v:any)=>void} fn
   * @returns {() => void} unsubscribe
   */
  subscribe(slice, fn) {
    const set = this.subs.get(slice);
    if (!set) return () => {};
    set.add(fn);
    return () => set.delete(fn);
  }

  /** @param {string} slice */
  _notify(slice) {
    const snap = this.get(/** @type {StateSlice} */ (slice));
    for (const fn of this.subs.get(slice) ?? []) fn(snap);
  }
}
