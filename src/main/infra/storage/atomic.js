/**
 * 原子写：临时文件 → fsync → rename。任何时刻磁盘上都只有「旧文件」或「新文件」，不存在半截。
 * @module main/infra/storage/atomic
 */
import { open, rename, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ok, err } from '../../../libs/utils/result.js';
import { ERROR_CODE } from '../../../libs/utils/errors.js';

/** @template T @typedef {import('../../../libs/utils/result.js').Result<T>} Result */
/** @typedef {import('../../../libs/utils/result.js').AppError} AppError */

/** 临时文件后缀特征：用于启动时清扫上次崩溃留下的残骸。 */
export const TMP_MARK = '.tmp.';

/**
 * @param {string} absPath 目标绝对路径
 * @param {string} text 完整内容
 * @param {{ fsync?: boolean }} [opts] fsync=false 仅用于可重建的缓存
 * @returns {Promise<Result<{ path: string, bytes: number }>>}
 */
export async function writeTextAtomic(absPath, text, opts = {}) {
  const fsync = opts.fsync !== false;
  const tmp = `${absPath}${TMP_MARK}${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  try {
    await mkdir(path.dirname(absPath), { recursive: true });
    const fh = await open(tmp, 'w');
    try {
      await fh.writeFile(text, 'utf8');
      if (fsync) await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, absPath); // POSIX rename 是原子的；Windows 同目录 rename 亦可
    return ok({ path: absPath, bytes: Buffer.byteLength(text) });
  } catch (e) {
    await unlink(tmp).catch(() => {});
    const error = /** @type {Error} */ (e);
    return err(ERROR_CODE.STORE_IO, `atomic write failed: ${error.message}`, {
      retryable: true,
      detail: { path: absPath },
    });
  }
}

/**
 * 只读读取；文件不存在返回 null（不是错误）。
 * @param {string} absPath
 * @returns {Promise<Result<string | null>>}
 */
export async function readTextSafe(absPath) {
  try {
    const { readFile } = await import('node:fs/promises');
    return ok(await readFile(absPath, 'utf8'));
  } catch (e) {
    const error = /** @type {NodeJS.ErrnoException} */ (e);
    if (error.code === 'ENOENT') return ok(null);
    return err(ERROR_CODE.STORE_IO, `read failed: ${error.message}`, { retryable: true, detail: { path: absPath } });
  }
}
