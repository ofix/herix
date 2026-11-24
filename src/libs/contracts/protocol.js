/**
 * 跨进程帧协议常量（主 ↔ Playwright worker 的 NDJSON over stdio）。
 * 帧类型一经冻结不得改名，只能新增。
 * @module libs/contracts/protocol
 */

/**
 * 帧类型。
 * @typedef {'hello'|'ready'|'ping'|'pong'|'site.open'|'site.close'|'login.check'|'task.send'|'command.run'|'reply.chunk'|'reply.end'|'shot.frame'|'health'|'error'|'log'} FrameType
 */
export const FRAME_TYPE = Object.freeze({
  HELLO: 'hello',
  READY: 'ready',
  PING: 'ping',
  PONG: 'pong',
  SITE_OPEN: 'site.open',
  SITE_CLOSE: 'site.close',
  LOGIN_CHECK: 'login.check',
  TASK_SEND: 'task.send',
  COMMAND_RUN: 'command.run',
  REPLY_CHUNK: 'reply.chunk',
  REPLY_END: 'reply.end',
  SHOT_FRAME: 'shot.frame',
  HEALTH: 'health',
  ERROR: 'error',
  LOG: 'log',
});

/** 心跳参数：每 3s 一次 ping，连续 3 次无 pong 判挂。 */
export const HEARTBEAT = Object.freeze({ INTERVAL_MS: 3000, MISS_LIMIT: 3 });

/** 单行帧上限 512KB；超限整行丢弃并记 error 帧。 */
export const FRAME_MAX_BYTES = 512 * 1024;

/**
 * 一帧的形状（运行时由 schemas/protocol.schema.js 校验）。
 * @typedef {object} Frame
 * @property {FrameType} type
 * @property {string} traceId
 * @property {number} seq       同一 traceId 内单调递增
 * @property {number} ts        发送端 Date.now()
 * @property {string} [siteId]
 * @property {object} [payload]
 */

/** 仅允许出现在 stdout 的帧类型（其余一律写 stderr，防污染协议流）。 */
export const STDOUT_FRAME_TYPES = Object.freeze([
  FRAME_TYPE.HELLO,
  FRAME_TYPE.READY,
  FRAME_TYPE.PONG,
  FRAME_TYPE.REPLY_CHUNK,
  FRAME_TYPE.REPLY_END,
  FRAME_TYPE.SHOT_FRAME,
]);
