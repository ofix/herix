/**
 * TraceContext：traceId 的唯一起源。派生出的子 trace 保留父链，便于跨进程回放。
 * @module main/infra/observability/trace
 */
import crypto from 'node:crypto';

/**
 * @typedef {object} Trace
 * @property {string} traceId
 * @property {string} [parentId]
 * @property {number} startedAt
 * @property {Record<string, string>} tags
 */

/**
 * @param {Record<string, string>} [tags]
 * @returns {Trace}
 */
export function newTrace(tags = {}) {
  return { traceId: `trc_${hex8()}`, startedAt: Date.now(), tags };
}

/**
 * 从父 trace 派生。子 trace 有自己的 id，但保留 parentId 用于串联。
 * @param {Trace} parent
 * @param {Record<string, string>} [tags]
 * @returns {Trace}
 */
export function childTrace(parent, tags = {}) {
  return { traceId: `trc_${hex8()}`, parentId: parent.traceId, startedAt: Date.now(), tags: { ...parent.tags, ...tags } };
}

/**
 * 把 trace 展开成日志字段（不包含 tags，避免污染结构化日志）。
 * @param {Trace} trace
 * @returns {{ traceId: string, parentId?: string }}
 */
export function traceFields(trace) {
  return trace.parentId ? { traceId: trace.traceId, parentId: trace.parentId } : { traceId: trace.traceId };
}

function hex8() {
  return crypto.randomBytes(4).toString('hex');
}
