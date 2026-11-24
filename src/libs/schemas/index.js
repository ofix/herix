/**
 * schema 聚合出口 + 全仓唯一的校验入口 parse()。
 * 校验失败一律返回 err(E_VALIDATION)，不抛异常。
 * @module libs/schemas
 */
import { ok, err } from '../utils/result.js';
import { ERROR_CODE } from '../utils/errors.js';

export * from './frame.schema.js';
export * from './task.schema.js';
export * from './site.schema.js';
export * from './conference.schema.js';
export * from './skill.schema.js';
export * from './codec.js';

/**
 * @typedef {object} ParseCtx
 * @property {string} [traceId]
 * @property {string} [where] 出错位置，用于日志定位
 */

/**
 * @template T
 * @param {import('zod').ZodType<T>} schema
 * @param {unknown} value
 * @param {ParseCtx} [ctx]
 * @returns {import('../utils/result.js').Result<T>}
 */
export function parse(schema, value, ctx = {}) {
  const r = schema.safeParse(value);
  if (r.success) return ok(r.data);
  const issues = r.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`);
  const message = `${ctx.where ? ctx.where + ' → ' : ''}${issues.slice(0, 3).join('; ')}`;
  return err(ERROR_CODE.VALIDATION, message, {
    traceId: ctx.traceId,
    detail: { issues: r.error.issues },
  });
}

/**
 * 批量解析数组元素，全部通过才返回；否则返回首个失败项。
 * @template T
 * @param {import('zod').ZodType<T>} schema
 * @param {unknown[]} items
 * @param {ParseCtx} [ctx]
 * @returns {import('../utils/result.js').Result<T[]>}
 */
export function parseAll(schema, items, ctx = {}) {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const r = parse(schema, items[i], { ...ctx, where: `${ctx.where ?? 'array'}[${i}]` });
    if (!r.ok) return r;
    out.push(r.value);
  }
  return ok(out);
}
