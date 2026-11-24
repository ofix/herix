/**
 * Journal：按月分文件的 JSONL 事件日志。只追加、只重放，不接受修改。
 * @module main/infra/storage/journal
 */
import { ok, err } from '../../../libs/utils/result.js';
import { ERROR_CODE } from '../../../libs/utils/errors.js';
import { nowIso, systemClock } from '../../../libs/utils/time.js';

/** @template T @typedef {import('../../../libs/utils/result.js').Result<T>} Result */
/** @typedef {import('../../../libs/contracts/index.js').DomainEvent} DomainEvent */

/** 允许的日志流：tasks / conferences / audit。 */
export const JOURNAL_NAMES = Object.freeze(['tasks', 'conferences', 'audit']);

export class Journal {
  /**
   * @param {import('./file-store.js').FileStore} fileStore
   * @param {{ clock?: () => number }} [deps]
   */
  constructor(fileStore, deps = {}) {
    this.fileStore = fileStore;
    this.clock = deps.clock ?? systemClock;
  }

  /**
   * 文件名规则：journal/<name>-YYYY-MM.jsonl
   * @param {string} name
   * @returns {string}
   */
  pathOf(name) {
    if (!JOURNAL_NAMES.includes(name)) throw new Error(`unknown journal: ${name}`);
    const month = nowIso(this.clock).slice(0, 7);
    return `journal/${name}-${month}.jsonl`;
  }

  /**
   * @param {string} name
   * @param {object} record 必须可 JSON 序列化；at 由本方法注入
   * @returns {Promise<Result<{ rel: string }>>}
   */
  async append(name, record) {
    let line;
    try {
      line = JSON.stringify({ ...record, at: nowIso(this.clock) });
    } catch (e) {
      const error = /** @type {Error} */ (e);
      return err(ERROR_CODE.VALIDATION, `journal record 不可序列化: ${error.message}`);
    }
    const rel = this.pathOf(name);
    const r = await this.fileStore.appendLine(rel, line);
    return r.ok ? ok({ rel }) : r;
  }

  /**
   * 读取并解析；坏行跳过并计数（坏行不得让整个回放失败）。
   * @param {string} rel
   * @returns {Promise<Result<{ records: object[], skipped: number }>>}
   */
  async read(rel) {
    const text = await this.fileStore.readText(rel);
    if (!text.ok) return text;
    if (text.value === null) return ok({ records: [], skipped: 0 });
    const records = [];
    let skipped = 0;
    for (const line of text.value.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        skipped += 1;
      }
    }
    return ok({ records, skipped });
  }
}
