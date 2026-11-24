/**
 * FileStore：userData/herix 下的唯一文件访问层。只做原子 I/O，不持有业务状态。
 * 同一路径的写操作串行化（内存 Promise 链），避免两个提交互相覆盖。
 * @module main/infra/storage/file-store
 */
import { mkdir, readdir, open } from 'node:fs/promises';
import path from 'node:path';
import { ok, err } from '../../../libs/utils/result.js';
import { ERROR_CODE } from '../../../libs/utils/errors.js';
import { writeTextAtomic, readTextSafe, TMP_MARK } from './atomic.js';

/** @template T @typedef {import('../../../libs/utils/result.js').Result<T>} Result */
/** @typedef {import('../../../libs/contracts/index.js').FileStorePort} FileStorePort */

export class FileStore {
  /**
   * @param {string} root 绝对根目录（userData/herix）
   */
  constructor(root) {
    this.root = root;
    /** @type {Map<string, Promise<unknown>>} 每路径写锁链 */
    this._locks = new Map();
  }

  /**
   * @param {string} rel
   * @returns {string}
   */
  abs(rel) {
    const p = path.resolve(this.root, rel);
    if (!p.startsWith(path.resolve(this.root))) throw new Error(`path escape: ${rel}`);
    return p;
  }

  /**
   * 同键串行：前一个任务无论成功失败，都先 settle，再进入下一个。
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  _withLock(key, fn) {
    const prev = this._locks.get(key) ?? Promise.resolve();
    const current = prev.then(fn, fn);
    this._locks.set(
      key,
      current.catch(() => {}),
    );
    return current;
  }

  /**
   * @param {string} rel
   * @returns {Promise<Result<string | null>>}
   */
  async readText(rel) {
    return readTextSafe(this.abs(rel));
  }

  /**
   * @param {string} rel
   * @param {string} text
   * @returns {Promise<Result<{ path: string, bytes: number }>>}
   */
  async writeTextAtomic(rel, text) {
    const abs = this.abs(rel);
    return this._withLock(abs, () => writeTextAtomic(abs, text));
  }

  /**
   * 追加一行（JSONL）。逐行 open/write/sync/close：慢一点，但崩溃后不会出现半行。
   * @param {string} rel
   * @param {string} line 单行，不得含 \n
   * @returns {Promise<Result<{ bytes: number }>>}
   */
  async appendLine(rel, line) {
    if (line.includes('\n')) {
      return err(ERROR_CODE.VALIDATION, 'appendLine 只接受单行文本', { detail: { rel } });
    }
    const abs = this.abs(rel);
    return this._withLock(abs, async () => {
      try {
        await mkdir(path.dirname(abs), { recursive: true });
        const fh = await open(abs, 'a');
        try {
          await fh.writeFile(`${line}\n`, 'utf8');
          await fh.sync();
        } finally {
          await fh.close();
        }
        return ok({ bytes: Buffer.byteLength(line) + 1 });
      } catch (e) {
        const error = /** @type {Error} */ (e);
        return err(ERROR_CODE.STORE_IO, `append failed: ${error.message}`, { retryable: true, detail: { rel } });
      }
    });
  }

  /**
   * @param {string} rel 目录
   * @returns {Promise<Result<string[]>>} 文件名（不含路径）
   */
  async list(rel) {
    try {
      const entries = await readdir(this.abs(rel));
      return ok(entries.filter((f) => !f.includes(TMP_MARK)));
    } catch (e) {
      const error = /** @type {NodeJS.ErrnoException} */ (e);
      if (error.code === 'ENOENT') return ok([]);
      return err(ERROR_CODE.STORE_IO, `list failed: ${error.message}`, { retryable: true, detail: { rel } });
    }
  }
}
