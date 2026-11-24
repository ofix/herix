/**
 * 帧协议运行时校验（NDJSON over stdio）。坏帧必须在这里被拦下。
 * @module libs/schemas/frame
 */
import { z } from 'zod';
import { FRAME_MAX_BYTES, FRAME_TYPE, HEARTBEAT } from '../contracts/protocol.js';

/** 帧类型枚举（与 FRAME_TYPE 的一致性由单测守护）。 */
export const FrameTypeSchema = z.enum([
  'hello',
  'ready',
  'ping',
  'pong',
  'site.open',
  'site.close',
  'login.check',
  'task.send',
  'command.run',
  'reply.chunk',
  'reply.end',
  'shot.frame',
  'health',
  'error',
  'log',
]);

/** traceId：trc_ + 8 位小写十六进制。 */
export const TraceIdSchema = z.string().regex(/^trc_[0-9a-f]{8}$/, 'traceId 必须形如 trc_xxxxxxxx');

/**
 * 一帧。.strict() 禁止多余字段——多余字段一律视为协议漂移。
 */
export const FrameSchema = z
  .object({
    type: FrameTypeSchema,
    traceId: TraceIdSchema,
    seq: z.number().int().nonnegative(),
    ts: z.number().int().nonnegative(),
    siteId: z.string().min(1).max(64).optional(),
    payload: z.record(z.unknown()).optional(),
  })
  .strict();

/** 心跳帧载荷。 */
export const HeartbeatSchema = z
  .object({ type: z.enum(['ping', 'pong']), seq: z.number().int().nonnegative() })
  .strict();

/** 单行字节上限（解码前先按字符串长度粗筛，避免 JSON.parse 大对象）。 */
export const FRAME_LIMIT = Object.freeze({ MAX_BYTES: FRAME_MAX_BYTES, MAX_MISSES: HEARTBEAT.MISS_LIMIT });

/** 帧类型常量再导出，供 codec 与测试共用。 */
export { FRAME_TYPE };
