/**
 * Result 容器与唯一构造函数。全仓不允许抛业务异常，只能返回 err。
 * @module libs/utils/result
 */

/**
 * 错误形状。code 必须是第 9 章列出的 E_* 之一。
 * @typedef {object} AppError
 * @property {string} code
 * @property {string} message
 * @property {boolean} retryable
 * @property {string} traceId
 * @property {unknown} [detail]
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T }} Ok
 */

/**
 * @typedef {{ ok: false, error: AppError }} Err
 */

/**
 * @template T
 * @typedef {Ok<T> | Err} Result
 */

/**
 * @template T
 * @param {T} value
 * @returns {Ok<T>}
 */
export function ok(value) {
  return { ok: true, value };
}

/**
 * @param {string} code
 * @param {string} message
 * @param {Partial<AppError>} [extra]
 * @returns {Err}
 */
export function err(code, message, extra = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: Boolean(extra.retryable),
      traceId: String(extra.traceId ?? 'trc_00000000'),
      ...(extra.detail === undefined ? {} : { detail: extra.detail }),
    },
  };
}

/**
 * @template T
 * @param {Result<T>} r
 * @returns {r is Ok<T>}
 */
export function isOk(r) {
  return r.ok === true;
}

/**
 * 取值或抛出——仅允许在进程边界（bootstrap / ipc handler）使用。
 * @template T
 * @param {Result<T>} r
 * @returns {T}
 */
export function unwrap(r) {
  if (r.ok) return r.value;
  throw new Error(`${r.error.code}: ${r.error.message}`);
}
