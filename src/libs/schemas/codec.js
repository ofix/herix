/**
 * NDJSON 帧编解码 + 长度护栏。纯逻辑、无 I/O，主进程与 worker 共用。
 * 坏帧只丢行、不抛异常、不崩进程。
 * @module libs/schemas/codec
 */
import { ok, err } from '../utils/result.js';
import { ERROR_CODE } from '../utils/errors.js';
import { FrameSchema, FRAME_LIMIT } from './frame.schema.js';

/** @template T @typedef {import('../../libs/utils/result.js').Result<T>} Result */
/** @typedef {import('../../libs/contracts/protocol.js').Frame} Frame */

/**
 * 编码为单行 NDJSON。超限直接拒绝（不发出去，避免对端误判为截断帧）。
 * @param {Frame} frame
 * @returns {Result<string>} 含行尾 \n
 */
export function encodeFrame(frame) {
  const check = FrameSchema.safeParse(frame);
  if (!check.success) {
    return err(ERROR_CODE.VALIDATION, `帧结构非法: ${check.error.issues[0]?.message ?? 'unknown'}`, {
      detail: { type: frame?.type },
    });
  }
  const line = JSON.stringify(check.data);
  if (Buffer.byteLength(line) > FRAME_LIMIT.MAX_BYTES) {
    return err(ERROR_CODE.VALIDATION, `帧超过 ${FRAME_LIMIT.MAX_BYTES} 字节上限`, { detail: { type: frame.type } });
  }
  return ok(`${line}\n`);
}

/**
 * 解码一行。任何异常都转成 err，绝不上抛。
 * 顺序：空行跳过 → 长度粗筛 → JSON.parse → schema 校验。
 * @param {string} raw 可能带 \r
 * @returns {Result<Frame | null>} null 表示该行应被忽略（空行）
 */
export function decodeLine(raw) {
  const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
  if (!line.trim()) return ok(null);
  if (Buffer.byteLength(line) > FRAME_LIMIT.MAX_BYTES) {
    return err(ERROR_CODE.VALIDATION, '帧超过长度上限，整行丢弃', { detail: { bytes: line.length } });
  }
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (e) {
    const error = /** @type {Error} */ (e);
    return err(ERROR_CODE.VALIDATION, `帧不是合法 JSON: ${error.message}`, { detail: { head: line.slice(0, 64) } });
  }
  const check = FrameSchema.safeParse(parsed);
  if (!check.success) {
    return err(ERROR_CODE.VALIDATION, `帧结构非法: ${check.error.issues[0]?.message ?? 'unknown'}`, {
      detail: { head: line.slice(0, 64) },
    });
  }
  return ok(check.data);
}

/**
 * 批量解码，统计坏行，用于「一次 read 多行」的场景。
 * @param {string} chunk 可能含多行
 * @returns {{ frames: Frame[], bad: number }}
 */
export function decodeChunk(chunk) {
  const frames = [];
  let bad = 0;
  for (const line of chunk.split('\n')) {
    const r = decodeLine(line);
    if (!r.ok) {
      bad += 1;
      continue;
    }
    if (r.value) frames.push(r.value);
  }
  return { frames, bad };
}
