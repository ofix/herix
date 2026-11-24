/**
 * PlaywrightBridge：主进程 ↔ Playwright worker 的唯一协议适配层。
 * 职责：把「业务调用」翻译成帧、按 traceId 关联应答、统一超时与取消。
 * 绝不允许 core / engine 直接碰 stdio。
 * @module main/bridges/playwright-bridge
 */
import { ok, err } from '../../libs/utils/result.js';
import { ERROR_CODE } from '../../libs/utils/errors.js';
import { FRAME_TYPE } from '../../libs/contracts/protocol.js';
import { newTrace } from '../infra/observability/trace.js';

/** @template T @typedef {import('../../libs/utils/result.js').Result<T>} Result */

/**
 * @typedef {object} Pending
 * @property {(v: any) => void} resolve
 * @property {(e: any) => void} reject
 * @property {NodeJS.Timeout} timer
 * @property {(chunk: string) => void} [onChunk]
 * @property {string} expect  期望的结束帧类型
 */

export class PlaywrightBridge {
  /**
   * @param {object} deps
   * @param {import('../core/runtime/worker-guard.js').WorkerGuard} deps.guard
   * @param {number} [deps.defaultTimeoutMs]
   */
  constructor({ guard, defaultTimeoutMs = 30_000 }) {
    this.guard = guard;
    this.defaultTimeoutMs = defaultTimeoutMs;
    /** @type {Map<string, Pending>} */
    this.pending = new Map();
    guard.on('frame', (/** @type {any} */ f) => this._onFrame(f));
    guard.on('down', () => this._rejectAll(ERROR_CODE.WORKER_DOWN, 'worker 已下线'));
  }

  /** @param {any} f */
  _onFrame(f) {
    const p = this.pending.get(f.traceId);
    if (!p) return; // 迟到帧 / 心跳应答，直接丢弃
    if (f.type === FRAME_TYPE.REPLY_CHUNK) {
      p.onChunk?.(String(f.payload?.chunk ?? ''));
      return;
    }
    if (f.type === FRAME_TYPE.ERROR) {
      this._settle(f.traceId, err(String(f.payload?.code ?? ERROR_CODE.WORKER_DOWN), String(f.payload?.message ?? 'worker 错误')));
      return;
    }
    this._settle(f.traceId, ok({ type: f.type, payload: f.payload }));
  }

  _settle(traceId, result) {
    const p = this.pending.get(traceId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(traceId);
    p.resolve(result);
  }

  _rejectAll(code, message) {
    for (const [id] of this.pending) {
      this._settle(id, err(code, message, { retryable: true }));
    }
  }

  /**
   * 发一帧并等一类结束帧。
   * @param {string} type
   * @param {object} payload
   * @param {object} [opts]
   * @param {string} [opts.siteId]
   * @param {number} [opts.timeoutMs]
   * @param {(chunk: string) => void} [opts.onChunk]
   * @param {string} [opts.expect]
   * @returns {Promise<Result<any>>}
   */
  request(type, payload, opts = {}) {
    const trace = newTrace({ via: 'bridge', frame: type });
    const expect = opts.expect ?? FRAME_TYPE.HEALTH;
    return new Promise((resolve) => {
      const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
      const timer = setTimeout(() => {
        this._settle(trace.traceId, err(ERROR_CODE.TIMEOUT, `等待 ${expect} 超时 (${timeoutMs}ms)`));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      this.pending.set(trace.traceId, {
        resolve,
        reject: () => {},
        timer,
        onChunk: opts.onChunk,
        expect,
      });
      const sent = this.guard.send({ type, traceId: trace.traceId, siteId: opts.siteId, payload });
      if (!sent.ok) {
        this._settle(trace.traceId, sent);
      }
    });
  }

  /** 握手：确认 worker 已就绪，并报告 chromium 是否可用。 */
  async hello() {
    const r = await this.request(FRAME_TYPE.HELLO, {}, { expect: FRAME_TYPE.READY, timeoutMs: 10_000 });
    if (!r.ok) return r;
    return ok(r.value.payload);
  }

  /**
   * 打开站点。
   * @param {object} site 已校验的站点配置
   * @param {{ interactive?: boolean, storageState?: object }} [opts]
   */
  openSite(site, opts = {}) {
    return this.request(
      FRAME_TYPE.SITE_OPEN,
      { site, interactive: opts.interactive, storageState: opts.storageState },
      { siteId: site.id, timeoutMs: 60_000 },
    );
  }

  /** @param {string} siteId */
  closeSite(siteId) {
    return this.request(FRAME_TYPE.SITE_CLOSE, {}, { siteId, timeoutMs: 10_000 });
  }

  /**
   * 交互式登录：可能耗时数分钟（等人工过验证码）。
   * @param {string} siteId
   * @param {{ timeoutMs?: number }} [opts]
   */
  login(siteId, opts = {}) {
    return this.request(FRAME_TYPE.LOGIN_CHECK, {}, { siteId, timeoutMs: opts.timeoutMs ?? 600_000 });
  }

  /**
   * 下发任务并流式收回复。
   * @param {object} args
   * @param {string} args.siteId
   * @param {string} args.prompt
   * @param {(chunk: string) => void} args.onChunk
   * @param {number} [args.timeoutMs]
   */
  sendTask({ siteId, prompt, onChunk, timeoutMs }) {
    return this.request(
      FRAME_TYPE.TASK_SEND,
      { prompt },
      { siteId, onChunk, expect: FRAME_TYPE.REPLY_END, timeoutMs: timeoutMs ?? 360_000 },
    );
  }
}
