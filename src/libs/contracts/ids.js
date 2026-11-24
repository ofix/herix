/**
 * ID 规则。ID 一律字符串 + 前缀 + 定长随机段，便于日志辨认与人工追溯。
 * @module libs/contracts/ids
 */

/** 各类 ID 的前缀（不得复用）。 */
export const ID_PREFIX = Object.freeze({
  TASK: 'tsk',
  SITE: 'ste',
  PROJECT: 'prj',
  CONFERENCE: 'cnf',
  CHANGESET: 'chg',
  TICKET: 'tkt',
  TRACE: 'trc',
  SESSION: 'ses',
  EVENT: 'evt',
});

/** @typedef {typeof ID_PREFIX[keyof typeof ID_PREFIX]} IdPrefix */

/** 完整 ID 形如 `tsk_9f2c1a7b`：前缀 3 字母 + 下划线 + 8 位小写十六进制。 */
export const ID_PATTERN = /^(tsk|ste|prj|cnf|chg|tkt|trc|ses|evt)_[0-9a-f]{8}$/;

/**
 * @param {unknown} value
 * @returns {boolean} 是否为合法 ID（纯函数，无副作用）
 */
export function isId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/** 幂等键形如 `idem_<sha1-ish>`，由调用方提供时必做长度校验。 */
export const IDEMPOTENCY_KEY_PATTERN = /^idem_[0-9a-zA-Z_-]{8,64}$/;
