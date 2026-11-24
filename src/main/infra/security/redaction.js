/**
 * 脱敏：任何落盘或上屏的数据先过这一层。密钥、cookie、长随机串一律遮盖。
 * @module main/infra/security/redaction
 */

/** 键名命中即遮盖（大小写不敏感，含子串匹配）。 */
export const SENSITIVE_KEYS = Object.freeze([
  'password',
  'passwd',
  'secret',
  'token',
  'cookie',
  'authorization',
  'apikey',
  'api_key',
  'storageState',
  'credential',
]);

/** 遮盖后的占位。保留长度信息，便于排查「确实是空值」还是「被遮了」。 */
export const MASK = '[REDACTED]';

const MAX_DEPTH = 8;

/**
 * @param {unknown} value
 * @param {{ maxString?: number }} [opts] 超长字符串（如 storageState 整串 base64）直接截断
 * @returns {unknown}
 */
export function redact(value, opts = {}) {
  return walk(value, 0, opts.maxString ?? 512);
}

/**
 * @param {unknown} value
 * @param {number} depth
 * @param {number} maxString
 * @returns {any}
 */
function walk(value, depth, maxString) {
  if (depth > MAX_DEPTH) return '[DEPTH_LIMIT]';
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string') {
      const clean = redactText(value);
      return clean.length > maxString ? `${clean.slice(0, 16)}…(${clean.length})` : clean;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1, maxString));

  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = isSensitiveKey(k) ? MASK : walk(v, depth + 1, maxString);
  }
  return out;
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isSensitiveKey(key) {
  const k = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => k.includes(s));
}

/**
 * 对自由文本做兜底遮盖（用于 stderr / 模型输出摘要）。
 * @param {string} text
 * @returns {string}
 */
export function redactText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/(sk-[A-Za-z0-9_-]{16,})/g, MASK)
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, `$1${MASK}`)
    .replace(/(?:^|[;,]\s*)cookie\s*[:=]\s*[^;,]{8,}/gi, (m) => `${m.split(/[=:]/)[0]}=${MASK}`);
}
