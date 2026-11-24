/**
 * TaskRepository：tasks 切片的持久化映射。只做 load/save/apply，不含业务判断。
 * @module main/core/state/repositories/task
 */
import { ok, err } from '../../../../libs/utils/result.js';
import { ERROR_CODE } from '../../../../libs/utils/errors.js';

/** @template T @typedef {import('../../../../libs/utils/result.js').Result<T>} Result */
/** @typedef {import('../../../../libs/contracts/index.js').FileStorePort} FileStorePort */
/** @typedef {import('../../../../libs/contracts/index.js').TaskRecord} TaskRecord */

export const TASKS_FILE = 'state/tasks.json';

export class TaskRepository {
  /** @param {FileStorePort} fileStore */
  constructor(fileStore) {
    this.fileStore = fileStore;
  }

  /**
   * @returns {Promise<Result<Record<string, TaskRecord>>>}
   */
  async load() {
    const r = await this.fileStore.readText(TASKS_FILE);
    if (!r.ok) return err(r.error.code, r.error.message);
    if (r.value === null) return ok({});
    try {
      const parsed = JSON.parse(r.value);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return err(ERROR_CODE.STORE_IO, 'tasks.json 结构非法（应为对象映射）');
      }
      return ok(parsed);
    } catch (e) {
      return err(ERROR_CODE.STORE_IO, `tasks.json 解析失败: ${/** @type {Error} */ (e).message}`);
    }
  }

  /**
   * @param {Record<string, TaskRecord>} records
   * @returns {Promise<Result<void>>}
   */
  async save(records) {
    const r = await this.fileStore.writeTextAtomic(TASKS_FILE, JSON.stringify(records));
    return r.ok ? ok(undefined) : err(r.error.code, r.error.message);
  }

  /**
   * 纯内存应用一个事件，返回新切片。持久化由 StateStore 统一调度。
   * @param {Record<string, TaskRecord>} slice
   * @param {any} event
   * @returns {Promise<Result<Record<string, TaskRecord>>>}
   */
  async apply(slice, event) {
    const next = { ...slice };
    const id = event.payload?.taskId ?? event.payload?.id;
    if (!id) return err(ERROR_CODE.VALIDATION, '任务事件缺少 taskId', { traceId: event.traceId });
    const prev = next[id];
    if (event.type === 'task.created') {
      next[id] = { ...event.payload, retryCount: 0 };
    } else if (prev) {
      next[id] = { ...prev, state: event.payload?.state ?? prev.state, updatedAt: event.at ?? prev.updatedAt };
      if (event.type === 'task.retry') next[id].retryCount = (prev.retryCount ?? 0) + 1;
    } else {
      return err(ERROR_CODE.VALIDATION, `任务不存在: ${id}`, { traceId: event.traceId });
    }
    return ok(next);
  }
}
