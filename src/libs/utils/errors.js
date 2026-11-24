/**
 * 骨架占位与错误码常量。
 * @module libs/utils/errors
 */

/** 全部业务错误码（与规约第 9 章一一对应，分段前缀即来源层）。 */
export const ERROR_CODE = Object.freeze({
  VALIDATION: 'E_VALIDATION',
  TOOL_MISSING: 'E_TOOL_MISSING',
  NOT_LOGGED_IN: 'E_NOT_LOGGED_IN',
  RISK_BLOCKED: 'E_RISK_BLOCKED',
  TIMEOUT: 'E_TIMEOUT',
  PATCH_PARSE: 'E_PATCH_PARSE',
  PATCH_CONFLICT: 'E_PATCH_CONFLICT',
  COMMAND_DENIED: 'E_COMMAND_DENIED',
  COMMAND_UNAUTHORIZED: 'E_COMMAND_UNAUTHORIZED',
  PROJECT_CLOSED: 'E_PROJECT_CLOSED',
  PROJECT_LIMIT: 'E_PROJECT_LIMIT',
  CONFERENCE_NO_QUORUM: 'E_CONFERENCE_NO_QUORUM',
  STORE_IO: 'E_STORE_IO',
  WORKER_DOWN: 'E_WORKER_DOWN',
});

/**
 * 骨架期占位。gen-skeleton 生成的方法体只 throw 它。
 * 填肉时删除 `@generated-skeleton` 头即视为接管，脚本不再覆盖。
 * @param {string} batch  批次号，如 'B5'
 * @param {string} where  'Class.method'
 * @returns {Error & { code: string, batch: string, where: string }}
 */
export function notImplemented(batch, where) {
  /** @type {any} */
  const e = new Error(`[${batch}] 未实现：${where}`);
  e.code = 'E_NOT_IMPLEMENTED';
  e.batch = batch;
  e.where = where;
  return e;
}

/**
 * 是否仍为骨架（api-surface 的状态判定依据）。
 * @param {Error & { code?: string }} e
 * @returns {boolean}
 */
export function isNotImplemented(e) {
  return e?.code === 'E_NOT_IMPLEMENTED';
}
