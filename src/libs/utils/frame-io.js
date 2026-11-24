/**
 * FrameIO：stdio 上的 NDJSON 收发。stdout 只走协议帧，日志一律 stderr。
 * 对上游（worker main）只暴露 send() 与回调，不暴露流对象。
 * @module libs/utils/frame-io
 */
import { ok, err } from './result.js';
import { ERROR_CODE } from './errors.js';
import { encodeFrame, decodeLine, FRAME_LIMIT } from '../schemas/index.js';

/** @template T @typedef {import('../../libs/utils/result.js').Result<T>} Result */
/** @typedef {import('../../libs/contracts/protocol.js').Frame} Frame */
/** @typedef {Omit<Frame, 'seq' | 'ts'> & { seq?: number, ts?: number }} OutFrame */

export class FrameIO {
  /**
   * @param {object} io
   * @param {import('node:stream').Readable} io.input 一般为 process.stdin
   * @param {import('node:stream').Writable} io.output 一般为 process.stdout
   * @param {(frame: Frame) => void} io.onFrame
   * @param {(reason: string, head?: string) => void} [io.onBadFrame]
   */
  constructor({ input, output, onFrame, onBadFrame }) {
    this.input = input;
    this.output = output;
    this.onFrame = onFrame;
    this.onBadFrame = onBadFrame ?? (() => {});
    this.buffer = '';
    this.seq = 0;
    /** @type {string} 最近一次上行 traceId，用于回帧 */
    this.lastTraceId = 'trc_00000000';
    this.closed = false;
  }

  /** 开始监听。返回解绑函数。 */
  attach() {
    const onData = (/** @type {Buffer|string} */ chunk) => this._onData(chunk);
    const onEnd = () => this.drain();
    this.input.on('data', onData);
    this.input.on('end', onEnd);
    return () => {
      this.input.off('data', onData);
      this.input.off('end', onEnd);
    };
  }

  /**
   * @param {Buffer|string} chunk
   */
  _onData(chunk) {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let idx = this.buffer.indexOf('\n');
    while (idx >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      this._handleLine(line);
      idx = this.buffer.indexOf('\n');
    }
    // 没有换行的超长残段：丢弃，避免内存被单帧拖爆
    if (Buffer.byteLength(this.buffer) > FRAME_LIMIT.MAX_BYTES) {
      this.onBadFrame(`oversize residual ${this.buffer.length}B`, this.buffer.slice(0, 32));
      this.buffer = '';
    }
  }

  /**
   * @param {string} line
   */
  _handleLine(line) {
    const r = decodeLine(line);
    if (!r.ok) {
      this.onBadFrame(r.error.message, line.slice(0, 32));
      return;
    }
    if (!r.value) return;
    this.lastTraceId = r.value.traceId;
    try {
      this.onFrame(r.value);
    } catch (e) {
      // 回调内部异常不得中断读取循环
      this.onBadFrame(`handler threw: ${/** @type {Error} */ (e).message}`);
    }
  }

  /** 收尾：处理没有换行结尾的最后一行。 */
  drain() {
    if (this.buffer.trim()) this._handleLine(this.buffer);
    this.buffer = '';
  }

  /**
   * 发送一帧。seq 与 ts 由本方法补齐（调用方不必关心）。
   * @param {OutFrame} frame
   * @returns {Result<{ bytes: number }>}
   */
  send(frame) {
    if (this.closed) return err(ERROR_CODE.WORKER_DOWN, 'frame-io 已关闭');
    const withMeta = {
      ...frame,
      seq: frame.seq ?? ++this.seq,
      ts: frame.ts ?? Date.now(),
    };
    const encoded = encodeFrame(/** @type {Frame} */ (withMeta));
    if (!encoded.ok) return encoded;
    this.output.write(encoded.value);
    return ok({ bytes: Buffer.byteLength(encoded.value) });
  }

  close() {
    this.closed = true;
    this.drain();
  }
}

/** stderr 结构化日志（永不进入协议流）。 */
export function logToStderr(level, message, fields = {}) {
  const line = JSON.stringify({ at: new Date().toISOString(), level, message, ...fields });
  process.stderr.write(`${line}\n`);
}
