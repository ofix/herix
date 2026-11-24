/**
 * ShotStream：登录期的截图流（仅用于「让人看清当前页面」）。
 * 三条硬约束：
 *  1. 只产 JPEG，单帧 ≤ 200KB，默认 2fps
 *  2. 丢帧不排队：上一帧没被消费就跳过，绝不积压（背压）
 *  3. 登录成功必须立即 stop 并清空缓存，不允许常驻截屏
 * @module workers/playwright-worker/shot-stream
 */
import { ok, err } from '../../libs/utils/result.js';
import { ERROR_CODE } from '../../libs/utils/errors.js';

/** @template T @typedef {import('../../libs/utils/result.js').Result<T>} Result */

export class ShotStream {
  /**
   * @param {object} deps
   * @param {() => import('playwright-core').Page | null} deps.getPage
   * @param {(frame: { seq: number, jpeg: string, bytes: number, at: number }) => boolean | void} deps.onFrame
   *   返回 false 表示「消费者忙」，下一帧直接跳过
   * @param {{ fps?: number, quality?: number, maxWidth?: number }} [opts]
   */
  constructor({ getPage, onFrame }, opts = {}) {
    this.getPage = getPage;
    this.onFrame = onFrame;
    this.fps = Math.min(Math.max(opts.fps ?? 2, 1), 3); // 1–3fps 是规约上限
    this.quality = Math.min(Math.max(opts.quality ?? 60, 30), 80);
    this.maxWidth = opts.maxWidth ?? 960;
    this.timer = null;
    this.busy = false;
    this.seq = 0;
    this.lastBytes = 0;
    this.dropped = 0;
  }

  get running() {
    return this.timer !== null;
  }

  /** @returns {Result<{ fps: number }>} */
  start() {
    if (this.timer) return ok({ fps: this.fps });
    const interval = Math.round(1000 / this.fps);
    this.timer = setInterval(() => {
      void this._tick();
    }, interval);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    return ok({ fps: this.fps });
  }

  async _tick() {
    if (this.busy) {
      this.dropped += 1; // 背压：不排队
      return;
    }
    const page = this.getPage();
    if (!page) return;
    this.busy = true;
    try {
      const buf = await page.screenshot({
        type: 'jpeg',
        quality: this.quality,
        animations: 'disabled',
        caret: 'hide',
      });
      const jpeg = buf.toString('base64');
      this.seq += 1;
      this.lastBytes = buf.byteLength;
      if (this.lastBytes > 200 * 1024) {
        this.dropped += 1; // 超预算帧丢弃，避免协议流被单帧拖爆
        return;
      }
      const consumed = this.onFrame({ seq: this.seq, jpeg, bytes: this.lastBytes, at: Date.now() });
      if (consumed === false) this.dropped += 1;
    } catch {
      // 页面重渲染瞬间截图失败属正常，下一拍继续
    } finally {
      this.busy = false;
    }
  }

  /** 立即停流并释放引用，返回统计。 */
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const stats = { frames: this.seq, dropped: this.dropped, lastBytes: this.lastBytes };
    this.seq = 0;
    this.dropped = 0;
    this.lastBytes = 0;
    return ok(stats);
  }

  /** @returns {{ running: boolean, fps: number, quality: number, frames: number, dropped: number }} */
  stats() {
    return {
      running: this.running,
      fps: this.fps,
      quality: this.quality,
      frames: this.seq,
      dropped: this.dropped,
    };
  }
}

/**
 * 防御性校验：非 JPEG/超预算的帧不得进入协议流。
 * @param {number} bytes
 * @returns {Result<void>}
 */
export function assertShotBudget(bytes) {
  if (bytes > 200 * 1024) return err(ERROR_CODE.VALIDATION, `截图帧超预算: ${bytes}B`);
  return ok(undefined);
}
