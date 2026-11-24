/**
 * WorkerGuard：子进程生命周期唯一管理者。
 *  - spawn → 握手 → 心跳（ping/pong）→ 连续 miss 判挂 → 指数退避重启
 *  - 只负责"进程活着"，不解释业务帧（业务帧交给 PlaywrightBridge）
 * @module main/core/runtime/worker-guard
 */
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { ok, err } from '../../../libs/utils/result.js';
import { ERROR_CODE } from '../../../libs/utils/errors.js';
import { FrameIO } from '../../../libs/utils/frame-io.js';
import { FRAME_TYPE } from '../../../libs/contracts/protocol.js';

/** @template T @typedef {import('../../../libs/utils/result.js').Result<T>} Result */

export class WorkerGuard extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.entry worker 入口绝对路径（打包后必须指向 app.asar.unpacked）
   * @param {number} [opts.heartbeatMs]
   * @param {number} [opts.missLimit]
   * @param {number} [opts.maxRestarts]
   * @param {(level:string, message:string, fields?:object)=>void} [opts.log]
   */
  constructor(opts) {
    super();
    this.entry = opts.entry;
    this.heartbeatMs = opts.heartbeatMs ?? 3000;
    this.missLimit = opts.missLimit ?? 3;
    this.maxRestarts = opts.maxRestarts ?? 5;
    this.log = opts.log ?? (() => {});
    /** @type {import('node:child_process').ChildProcess | null} */
    this.child = null;
    /** @type {FrameIO | null} */
    this.io = null;
    this.misses = 0;
    this.restarts = 0;
    this.timer = null;
    this.state = 'idle'; // idle|starting|ready|down|stopped
  }

  /** @returns {Promise<Result<{ pid: number }>>} */
  async start() {
    if (this.child) return ok({ pid: this.child.pid ?? -1 });
    this.state = 'starting';
    const started = await this._spawn();
    if (!started.ok) {
      this.state = 'down';
      return started;
    }
    this.state = 'ready';
    this._startHeartbeat();
    return started;
  }

  async _spawn() {
    try {
      const child = spawn(process.execPath, [this.entry], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, HERIX_ROLE: 'playwright-worker' },
        cwd: path.dirname(this.entry),
      });
      this.child = child;
      const stdin = child.stdin;
      const stdout = child.stdout;
      if (!stdin || !stdout) return err(ERROR_CODE.WORKER_DOWN, 'worker 管道不可用');

      this.io = new FrameIO({
        input: stdout,
        output: stdin,
        onFrame: (f) => {
          if (f.type === FRAME_TYPE.PONG) {
            this.misses = 0;
            return;
          }
          this.emit('frame', f);
        },
        onBadFrame: (reason) => this.log('warn', 'worker bad frame', { reason }),
      });
      this.io.attach();

      child.stderr?.on('data', (buf) => this.log('debug', 'worker stderr', { line: String(buf).slice(0, 500) }));
      child.on('exit', (code, signal) => this._onExit(code, signal));
      child.on('error', (e) => this.log('error', 'worker spawn error', { message: e.message }));

      this.misses = 0;
      return ok({ pid: child.pid ?? -1 });
    } catch (e) {
      return err(ERROR_CODE.WORKER_DOWN, `worker 启动失败: ${/** @type {Error} */ (e).message}`);
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.timer = setInterval(() => {
      if (this.state !== 'ready') return;
      this.misses += 1;
      if (this.misses > this.missLimit) {
        this.log('error', 'worker heartbeat lost', { misses: this.misses });
        this.state = 'down';
        this.emit('down', { reason: 'heartbeat' });
        void this._restart();
        return;
      }
      this.io?.send({ type: FRAME_TYPE.PING, traceId: 'trc_00000000' });
    }, this.heartbeatMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  _stopHeartbeat() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** @param {number|null} code @param {string|null} signal */
  _onExit(code, signal) {
    this.log('warn', 'worker exited', { code, signal });
    this.child = null;
    this.io = null;
    if (this.state === 'stopped') return;
    this.state = 'down';
    this.emit('down', { reason: 'exit', code, signal });
    void this._restart();
  }

  async _restart() {
    if (this.state === 'stopped') return;
    if (this.restarts >= this.maxRestarts) {
      this.log('error', 'worker restart limit reached', { restarts: this.restarts });
      this.emit('gaveup', { restarts: this.restarts });
      return;
    }
    this.restarts += 1;
    const backoff = Math.min(30_000, 500 * 2 ** (this.restarts - 1));
    this.log('info', 'worker restarting', { attempt: this.restarts, backoff });
    await new Promise((r) => setTimeout(r, backoff));
    if (this.state === 'stopped') return;
    const r = await this.start();
    if (r.ok) {
      this.emit('restarted', { attempt: this.restarts, pid: r.value.pid });
    } else {
      void this._restart();
    }
  }

  /**
   * @param {any} frame
   * @returns {Result<{ bytes: number }>}
   */
  send(frame) {
    if (!this.io || this.state !== 'ready') return err(ERROR_CODE.WORKER_DOWN, 'worker 不可用');
    return this.io.send(frame);
  }

  async stop() {
    this.state = 'stopped';
    this._stopHeartbeat();
    const child = this.child;
    this.child = null;
    this.io?.close();
    this.io = null;
    if (child) {
      child.kill('SIGTERM');
      await new Promise((r) => {
        const t = setTimeout(() => {
          child.kill('SIGKILL');
          r(null);
        }, 3000);
        child.once('exit', () => {
          clearTimeout(t);
          r(null);
        });
      });
    }
    return ok({ stopped: true });
  }

  stats() {
    return { state: this.state, pid: this.child?.pid ?? null, misses: this.misses, restarts: this.restarts };
  }
}
