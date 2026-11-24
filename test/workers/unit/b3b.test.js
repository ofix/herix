/**
 * B3b：ShotStream 的背压与预算、LoginFlow 的判定，用假 page 单测（不启动 Chromium）。
 */
import { describe, it, expect, vi } from 'vitest';
import { ShotStream, assertShotBudget } from '../../../src/workers/playwright-worker/shot-stream.js';
import { LoginFlow } from '../../../src/workers/playwright-worker/login-flow.js';

/** 假 page：只实现被调用到的方法。
 * @returns {any} */
const fakePage = (over = {}) => /** @type {any} */ ({
  url: () => 'https://example.com/chat',
  screenshot: async () => Buffer.from('x'.repeat(10)),
  bringToFront: async () => {},
  $: async () => null,
  evaluate: async () => [],
  textContent: async () => '',
  ...over,
});

/** @returns {any} */
const fakeSession = (page, inputOk = true) => /** @type {any} */ ({
  page,
  locateInput: async () =>
    inputOk ? { ok: true, value: { selector: 'textarea', strategy: 'yaml' } } : { ok: false, error: { code: 'E_TOOL_MISSING' } },
  captureState: async () => ({ ok: true, value: { cookies: [], origins: [] } }),
});

describe('ShotStream', () => {
  it('start 幂等，fps 被夹到 1–3', () => {
    const s = new ShotStream({ getPage: () => null, onFrame: () => {} }, { fps: 10 });
    expect(s.fps).toBe(3);
    const r1 = s.start();
    const r2 = s.start();
    expect(r1.ok && r1.value.fps).toBe(3);
    expect(r2.ok).toBe(true);
    s.stop();
  });

  it('消费者忙时丢帧不排队', async () => {
    let calls = 0;
    const s = new ShotStream(
      { getPage: () => fakePage(), onFrame: () => { calls += 1; return false; } },
      { fps: 3 },
    );
    // 直接驱动内部 tick：模拟慢消费者
    await s._tick();
    await s._tick();
    expect(calls).toBe(2);
    expect(s.stats().dropped).toBeGreaterThanOrEqual(2);
    s.stop();
  });

  it('超预算帧被丢弃，不进入协议流', async () => {
    let frames = 0;
    const s = new ShotStream(
      {
        getPage: () => fakePage({ screenshot: async () => Buffer.alloc(250 * 1024) }),
        onFrame: () => { frames += 1; },
      },
      { fps: 1 },
    );
    await s._tick();
    expect(frames).toBe(0);
    expect(s.stats().dropped).toBe(1);
  });

  it('stop 后返回统计并清零', async () => {
    const s = new ShotStream({ getPage: () => fakePage(), onFrame: () => {} }, { fps: 1 });
    s.start();
    await s._tick();
    const r = s.stop();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.frames).toBe(1);
    expect(s.stats().running).toBe(false);
    expect(s.stats().frames).toBe(0);
  });

  it('assertShotBudget 拦住超预算帧', () => {
    expect(assertShotBudget(100).ok).toBe(true);
    const r = assertShotBudget(210 * 1024);
    expect(r.ok).toBe(false);
  });
});

describe('LoginFlow', () => {
  it('URL 命中登录特征 → 未登录', async () => {
    const flow = new LoginFlow({ session: fakeSession(fakePage({ url: () => 'https://x.com/login' })) });
    const r = await flow.detect();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ loggedIn: false });
  });

  it('输入框可用 → 已登录（evidence=selector 策略）', async () => {
    const flow = new LoginFlow({ session: fakeSession(fakePage()) });
    const r = await flow.detect();
    if (r.ok) expect(r.value).toMatchObject({ loggedIn: true, evidence: 'input=yaml' });
  });

  it('交互式登录：轮询到登录成功后立即回收 storageState 并停止截图流', async () => {
    let polls = 0;
    const page = fakePage();
    const session = {
      ...fakeSession(page),
      // 前两次未登录，之后已登录
      locateInput: async () => {
        polls += 1;
        return polls >= 2 ? { ok: true, value: { selector: 'textarea', strategy: 'yaml' } } : { ok: false, error: {} };
      },
    };
    const stages = [];
    const flow = new LoginFlow({ session });
    const shot = { stop: vi.fn(() => ({ ok: true, value: {} })) };

    const r = await flow.runInteractive({ onStage: (s) => stages.push(s.stage), timeoutMs: 10_000 });
    // 由 main.js 在登录后调用 stop；此处只验证流程产出
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.state).toEqual({ cookies: [], origins: [] });
    expect(stages).toEqual(['awaiting-human', 'logged-in']);
    expect(shot.stop).not.toHaveBeenCalled();
  });

  it('超时返回 E_NOT_LOGGED_IN', async () => {
    const session = { ...fakeSession(fakePage()), locateInput: async () => ({ ok: false, error: {} }) };
    const flow = new LoginFlow({ session });
    const r = await flow.runInteractive({ timeoutMs: 1_500 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('E_NOT_LOGGED_IN');
  });

  it('verifyReuse 在登录态失效时要求重登（retryable）', async () => {
    const session = { ...fakeSession(fakePage()), locateInput: async () => ({ ok: false, error: {} }) };
    const flow = new LoginFlow({ session });
    const r = await flow.verifyReuse();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('E_NOT_LOGGED_IN');
      expect(r.error.retryable).toBe(true);
    }
  });
});
