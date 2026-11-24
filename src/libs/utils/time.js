/**
 * 时间工具。**禁止业务代码直接 Date.now()**：时钟必须作为参数注入，保证状态机可测。
 * @module libs/utils/time
 */

/**
 * @typedef {() => number} Clock 返回毫秒时间戳
 */

/** 取消信号标准化异常。 */
export class AbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

/** 生产用时钟。测试时传入假时钟。 */
export const systemClock = () => Date.now();

/**
 * @param {Clock} [clock]
 * @returns {string} ISO 8601（UTC）
 */
export function nowIso(clock = systemClock) {
  return new Date(clock()).toISOString();
}

/**
 * @param {string} iso
 * @returns {boolean}
 */
export function isIsoTimestamp(iso) {
  return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(iso) && !Number.isNaN(Date.parse(iso));
}

/**
 * 推迟函数。仅用于退避等待，不得在纯逻辑中使用。
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new AbortError());
      },
      { once: true },
    );
  });
}
