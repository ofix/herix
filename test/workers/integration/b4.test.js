/**
 * B4：真进程测试 —— 拉起真 worker，验证握手、心跳、崩溃自动重启、请求超时。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WorkerGuard } from '../../../src/main/core/runtime/worker-guard.js';
import { PlaywrightBridge } from '../../../src/main/bridges/playwright-bridge.js';

const ENTRY = fileURLToPath(new URL('../../../src/workers/playwright-worker/main.js', import.meta.url));

/** @type {WorkerGuard[]} */
const guards = [];

function makeGuard(over = {}) {
  const guard = new WorkerGuard({ entry: path.resolve(ENTRY), heartbeatMs: 1000, missLimit: 2, ...over });
  guards.push(guard);
  return guard;
}

afterEach(async () => {
  await Promise.all(guards.splice(0).map((g) => g.stop()));
});

describe('WorkerGuard + PlaywrightBridge（真子进程）', () => {
  it('start 后能握手到 ready，并报告 chromium 可用性', async () => {
    const guard = makeGuard();
    const started = await guard.start();
    expect(started.ok).toBe(true);
    const bridge = new PlaywrightBridge({ guard });
    const hello = await bridge.hello();
    expect(hello.ok).toBe(true);
    if (hello.ok) {
      expect(hello.value).toHaveProperty('pid');
      expect(['ok', 'missing']).toContain(hello.value.chromium);
    }
    expect(guard.stats().state).toBe('ready');
  }, 20_000);

  it('心跳维持 misses=0（worker 会回 pong）', async () => {
    const guard = makeGuard({ heartbeatMs: 500 });
    await guard.start();
    await new Promise((r) => setTimeout(r, 2200));
    expect(guard.stats().misses).toBe(0);
    expect(guard.stats().state).toBe('ready');
  }, 15_000);

  it('请求超时会返回 E_TIMEOUT 而不是无限挂起', async () => {
    const guard = makeGuard();
    await guard.start();
    const bridge = new PlaywrightBridge({ guard, defaultTimeoutMs: 1000 });
    // shot.frame 是「主→worker 不处理」的合法帧，worker 静默丢弃 → 必超时
    const r = await bridge.request('shot.frame', {}, { timeoutMs: 800, expect: 'ready' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('E_TIMEOUT');
  }, 20_000);

  it('worker 被杀后能被 guard 自动重启（restarts >= 1）', async () => {
    const guard = makeGuard({ heartbeatMs: 800, missLimit: 2 });
    await guard.start();
    const pid1 = guard.stats().pid;

    /** @type {Promise<any>} */
    const restarted = new Promise((resolve) => guard.once('restarted', resolve));
    guard.child?.kill('SIGKILL');
    const info = await restarted;
    expect(info.pid).not.toBe(pid1);
    expect(guard.stats().restarts).toBeGreaterThanOrEqual(1);
    expect(guard.stats().state).toBe('ready');
  }, 25_000);

  it('stop 后进程确实退出，且状态为 stopped', async () => {
    const guard = makeGuard();
    await guard.start();
    const pid = guard.stats().pid;
    await guard.stop();
    expect(guard.stats().state).toBe('stopped');
    // 给 OS 一点时间回收
    await new Promise((r) => setTimeout(r, 500));
    let alive = true;
    try {
      process.kill(/** @type {number} */ (pid), 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
  }, 20_000);
});
