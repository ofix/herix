/**
 * B9a：IPC 网关（通道白名单 + zod 校验 + 统一信封）、装配入口、preload 通道一致性。
 * Electron 本体不在依赖里，因此全部用假 app/ipcMain 注入测装配逻辑。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CHANNEL, CHANNEL_LIST } from '../../../src/libs/contracts/channels.js';
import { Gateway, invokeLocal } from '../../../src/main/ipc/gateway.js';
import { bootstrap } from '../../../src/main/bootstrap.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');

/** 假 ipcMain：记录注册的通道 */
function fakeIpc() {
  /** @type {Map<string, Function>} */
  const handlers = new Map();
  return {
    handlers,
    handle: (c, f) => handlers.set(c, f),
    removeHandler: (c) => handlers.delete(c),
  };
}

const fakeApp = (over = {}) => ({
  userData: '/tmp/herix-b9a',
  requestSingleInstanceLock: () => true,
  quit: () => {},
  whenReady: async () => {},
  ...over,
});

describe('通道契约', () => {
  it('CHANNEL_LIST 与 CHANNEL 值一一对应', () => {
    expect(CHANNEL_LIST).toEqual(Object.values(CHANNEL));
    expect(new Set(CHANNEL_LIST).size).toBe(CHANNEL_LIST.length);
  });

  it('preload 里写死的通道名与 contracts 完全一致（防止改一处漏一处）', () => {
    const txt = readFileSync(path.join(ROOT, 'src/preload/herix-api.cjs'), 'utf8');
    const declared = [...txt.matchAll(/^\s{2}([A-Z_]+): '([a-z]+:[a-z]+)',/gm)].map((m) => [m[1], m[2]]);
    expect(declared.length).toBeGreaterThan(0);
    for (const [k, v] of declared) expect(CHANNEL[/** @type {keyof CHANNEL} */ (k)]).toBe(v);
  });
});

describe('Gateway', () => {
  const mkGw = (handlers) => {
    const ipc = fakeIpc();
    const gw = new Gateway({ ipcMain: ipc, handlers, clock: () => 5000 });
    return { gw, ipc };
  };

  it('只注册白名单通道，注册数量正确', () => {
    const { gw, ipc } = mkGw({ [CHANNEL.APP_INFO]: { fn: () => ({ v: 1 }) } });
    const r = gw.install();
    expect(r.ok).toBe(true);
    expect([...ipc.handlers.keys()]).toEqual([CHANNEL.APP_INFO]);
  });

  it('注册非白名单通道被拒绝', () => {
    const { gw } = mkGw({ 'evil:run': { fn: () => 1 } });
    const r = gw.install();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('evil:run');
  });

  it('成功调用返回 {ok,value,traceId,elapsedMs}', async () => {
    const { gw, ipc } = mkGw({ [CHANNEL.APP_INFO]: { fn: () => ({ version: '1' }) } });
    gw.install();
    const env = await /** @type {Function} */ (ipc.handlers.get(CHANNEL.APP_INFO))();
    expect(env).toMatchObject({ ok: true, value: { version: '1' } });
    expect(env.traceId).toMatch(/^trc_ipc\d{5}$/);
    expect(env.elapsedMs).toBe(0);
  });

  it('handler 返回 err 时信封 ok=false 且带 code', async () => {
    const { gw, ipc } = mkGw({ [CHANNEL.APP_INFO]: { fn: () => ({ ok: false, error: { code: 'E_TIMEOUT', message: '超时' } }) } });
    gw.install();
    const env = await /** @type {Function} */ (ipc.handlers.get(CHANNEL.APP_INFO))();
    expect(env.ok).toBe(false);
    expect(env.error.code).toBe('E_TIMEOUT');
  });

  it('handler 抛异常被吞成信封错误，不冒泡', async () => {
    const { gw, ipc } = mkGw({
      [CHANNEL.APP_INFO]: {
        fn: () => {
          throw new Error('boom');
        },
      },
    });
    gw.install();
    const env = await /** @type {Function} */ (ipc.handlers.get(CHANNEL.APP_INFO))();
    expect(env.ok).toBe(false);
    expect(env.error.message).toContain('boom');
  });

  it('zod 校验失败 → E_VALIDATION 且带 issue 路径', async () => {
    const { z } = await import('zod');
    const { gw, ipc } = mkGw({
      [CHANNEL.TASK_SUBMIT]: { schema: z.object({ a: z.number() }), fn: () => 1 },
    });
    gw.install();
    const env = await /** @type {Function} */ (ipc.handlers.get(CHANNEL.TASK_SUBMIT))({}, { a: 'x' });
    expect(env.ok).toBe(false);
    expect(env.error.code).toBe('E_VALIDATION');
    expect(env.error.detail[0].path).toBe('a');
  });

  it('dispose 注销所有通道', async () => {
    const { gw, ipc } = mkGw({ [CHANNEL.APP_INFO]: { fn: () => 1 }, [CHANNEL.STATE_SNAPSHOT]: { fn: () => 2 } });
    gw.install();
    await gw.dispose();
    expect(ipc.handlers.size).toBe(0);
  });

  it('invokeLocal 便于测试/调试', async () => {
    const { gw } = mkGw({ [CHANNEL.APP_INFO]: { fn: () => 'x' } });
    const env = await invokeLocal(gw, CHANNEL.APP_INFO, {});
    expect(env.ok && env.value).toBe('x');
    const missing = await invokeLocal(gw, CHANNEL.CONFIG_RELOAD, {});
    expect(missing.ok).toBe(false);
  });
});

describe('bootstrap', () => {
  it('单实例锁拿不到直接失败并退出', async () => {
    let quit = false;
    const r = await bootstrap({
      app: fakeApp({ requestSingleInstanceLock: () => false, quit: () => { quit = true; } }),
      ipcMain: fakeIpc(),
    });
    expect(r.ok).toBe(false);
    expect(quit).toBe(true);
  });

  it('正常装配：网关注册成功、ctx 有各服务', async () => {
    const ipc = fakeIpc();
    const r = await bootstrap({ app: fakeApp(), ipcMain: ipc });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.ctx.engine).toBeTruthy();
    expect(r.value.ctx.projects).toBeTruthy();
    expect(r.value.ctx.checks).toBeTruthy();
    expect(ipc.handlers.size).toBeGreaterThan(5);
    await r.value.dispose();
  });

  it('app:info 返回路径与资源信息', async () => {
    const ipc = fakeIpc();
    const r = await bootstrap({ app: fakeApp(), ipcMain: ipc });
    if (!r.ok) throw new Error('bootstrap failed');
    const env = await /** @type {Function} */ (ipc.handlers.get(CHANNEL.APP_INFO))({});
    expect(env.ok).toBe(true);
    expect(env.value.paths.workerEntry).toContain('playwright-worker/main.js');
    expect(env.value.paths.packaged).toBe(false);
  });

  it('打包态的 worker 路径走 asar.unpacked', async () => {
    const ipc = fakeIpc();
    const r = await bootstrap({ app: fakeApp({ resourcesPath: '/opt/herix/resources' }), ipcMain: ipc });
    if (!r.ok) throw new Error('bootstrap failed');
    const env = await /** @type {Function} */ (ipc.handlers.get(CHANNEL.APP_INFO))({});
    expect(env.value.paths.workerEntry).toContain('app.asar.unpacked');
    expect(env.value.paths.packaged).toBe(true);
  });

  it('project:open 缺 projectId 被 zod 拒绝', async () => {
    const ipc = fakeIpc();
    const r = await bootstrap({ app: fakeApp(), ipcMain: ipc });
    if (!r.ok) throw new Error('bootstrap failed');
    const env = await /** @type {Function} */ (ipc.handlers.get(CHANNEL.PROJECT_OPEN))({}, { repoPath: '/tmp/x' });
    expect(env.ok).toBe(false);
    expect(env.error.code).toBe('E_VALIDATION');
  });

  it('task:approve 的 taskId 必须符合 id 规则', async () => {
    const ipc = fakeIpc();
    const r = await bootstrap({ app: fakeApp(), ipcMain: ipc });
    if (!r.ok) throw new Error('bootstrap failed');
    const bad = await /** @type {Function} */ (ipc.handlers.get(CHANNEL.TASK_APPROVE))({}, { taskId: 'nope', decision: 'approve' });
    expect(bad.ok).toBe(false);
    const good = await /** @type {Function} */ (ipc.handlers.get(CHANNEL.TASK_APPROVE))({}, { taskId: 'tsk_0011aabb', decision: 'approve' });
    // 校验已通过，落到业务层"任务不存在"（错误码同为 E_VALIDATION，用消息区分）
    expect(good.ok).toBe(false);
    expect(good.error.message).toContain('任务不存在');
  });
});
