#!/usr/bin/env node
/**
 * Playwright worker 主循环（独立子进程）。协议：NDJSON over stdio。
 * 职责边界：
 *  - 只做「页面操作」，不做调度、不做存储、不碰密钥文件
 *  - stdout 只写协议帧；一切日志走 stderr
 *  - 收到 ping 必须回 pong（心跳由主进程判定）
 * @module workers/playwright-worker/main
 */
import { chromium } from 'playwright-core';
import { FrameIO, logToStderr } from '../../libs/utils/frame-io.js';
import { SiteSession } from './site-session.js';
import { LoginFlow } from './login-flow.js';
import { ShotStream } from './shot-stream.js';
import { FRAME_TYPE, HEARTBEAT } from '../../libs/contracts/protocol.js';
import { err } from '../../libs/utils/result.js';
import { ERROR_CODE } from '../../libs/utils/errors.js';

const log = (level, message, fields = {}) => logToStderr(level, message, fields);

/** @type {import('playwright-core').Browser | null} */
let browser = null;
/** @type {Map<string, SiteSession>} */
const sessions = new Map();
/** @type {ShotStream | null} */
let shotStream = null;

const io = new FrameIO({
  input: process.stdin,
  output: process.stdout,
  onFrame: (frame) => {
    void handle(frame);
  },
  onBadFrame: (reason, head) => log('warn', 'bad frame', { reason, head }),
});

/**
 * @param {import('../../libs/contracts/protocol.js').Frame} frame
 */
async function handle(frame) {
  const base = { type: frame.type, traceId: frame.traceId, siteId: frame.siteId };
  switch (frame.type) {
    case FRAME_TYPE.HELLO: {
      await ensureBrowser();
      io.send({ ...base, type: FRAME_TYPE.READY, payload: { pid: process.pid, chromium: browser ? 'ok' : 'missing' } });
      return;
    }
    case FRAME_TYPE.PING:
      io.send({ ...base, type: FRAME_TYPE.PONG, payload: { missLimit: HEARTBEAT.MISS_LIMIT } });
      return;
    case FRAME_TYPE.SITE_OPEN:
      await openSite(frame);
      return;
    case FRAME_TYPE.SITE_CLOSE: {
      const s = frame.siteId ? sessions.get(frame.siteId) : null;
      if (s) {
        await s.close();
        sessions.delete(/** @type {string} */ (frame.siteId));
      }
      io.send({ ...base, type: FRAME_TYPE.HEALTH, payload: { closed: frame.siteId } });
      return;
    }
    case FRAME_TYPE.LOGIN_CHECK:
      await checkLogin(frame);
      return;
    case FRAME_TYPE.TASK_SEND:
      await runTask(frame);
      return;
    case FRAME_TYPE.SHOT_FRAME:
      return; // 主→worker 不发截图帧
    default:
      io.send({ ...base, type: FRAME_TYPE.ERROR, payload: { code: ERROR_CODE.VALIDATION, message: `未知帧 ${frame.type}` } });
  }
}

async function ensureBrowser() {
  if (browser) return true;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-device-scale-factor'] });
    log('info', 'chromium launched');
    return true;
  } catch (e) {
    browser = null;
    log('error', 'chromium launch failed', { message: /** @type {Error} */ (e).message });
    return false;
  }
}

/** @param {import('../../libs/contracts/protocol.js').Frame} frame */
async function openSite(frame) {
  const site = frame.payload?.site;
  const base = { type: FRAME_TYPE.HEALTH, traceId: frame.traceId, siteId: frame.siteId };
  if (!site?.id) {
    io.send({ ...base, type: FRAME_TYPE.ERROR, payload: { code: ERROR_CODE.VALIDATION, message: 'site 配置缺失' } });
    return;
  }
  if (!(await ensureBrowser())) {
    io.send({ ...base, type: FRAME_TYPE.ERROR, payload: { code: ERROR_CODE.TOOL_MISSING, message: 'chromium 未安装' } });
    return;
  }
  const session = new SiteSession({ browser: /** @type {any} */ (browser), site, log });
  const opened = await session.open({
    interactive: Boolean(frame.payload?.interactive),
    storageState: frame.payload?.storageState,
  });
  if (!opened.ok) {
    io.send({ ...base, type: FRAME_TYPE.ERROR, payload: { code: opened.error.code, message: opened.error.message } });
    return;
  }
  sessions.set(site.id, session);
  io.send({ ...base, payload: { opened: true, url: opened.value.url } });

  if (frame.payload?.interactive) {
    shotStream = new ShotStream({
      getPage: () => session.page,
      onFrame: (f) => {
        io.send({ type: FRAME_TYPE.SHOT_FRAME, traceId: frame.traceId, siteId: site.id, payload: f });
      },
    });
    shotStream.start();
  }
}

/** @param {import('../../libs/contracts/protocol.js').Frame} frame */
async function checkLogin(frame) {
  const session = frame.siteId ? sessions.get(frame.siteId) : null;
  const base = { type: FRAME_TYPE.HEALTH, traceId: frame.traceId, siteId: frame.siteId };
  if (!session) {
    io.send({ ...base, type: FRAME_TYPE.ERROR, payload: { code: ERROR_CODE.WORKER_DOWN, message: '站点未打开' } });
    return;
  }
  const flow = new LoginFlow({ session, log });
  const r = await flow.runInteractive({
    onStage: (s) => io.send({ ...base, payload: s }),
  });
  shotStream?.stop();
  if (!r.ok) {
    io.send({ ...base, type: FRAME_TYPE.ERROR, payload: { code: r.error.code, message: r.error.message } });
    return;
  }
  // 登录态必须交给主进程加密保存，worker 不写文件
  io.send({ ...base, payload: { loggedIn: true, storageState: r.value.state } });
}

/** @param {import('../../libs/contracts/protocol.js').Frame} frame */
async function runTask(frame) {
  const session = frame.siteId ? sessions.get(frame.siteId) : null;
  const base = { type: FRAME_TYPE.REPLY_CHUNK, traceId: frame.traceId, siteId: frame.siteId };
  if (!session) {
    io.send({ ...base, type: FRAME_TYPE.ERROR, payload: { code: ERROR_CODE.WORKER_DOWN, message: '站点未打开' } });
    return;
  }
  const sent = await session.sendPrompt(String(frame.payload?.prompt ?? ''));
  if (!sent.ok) {
    io.send({ ...base, type: FRAME_TYPE.ERROR, payload: { code: sent.error.code, message: sent.error.message } });
    return;
  }
  const read = await session.readReply({
    traceId: frame.traceId,
    onChunk: (chunk) => io.send({ ...base, type: FRAME_TYPE.REPLY_CHUNK, payload: { chunk } }),
  });
  if (!read.ok) {
    io.send({ ...base, type: FRAME_TYPE.ERROR, payload: { code: read.error.code, message: read.error.message } });
    return;
  }
  io.send({
    ...base,
    type: FRAME_TYPE.REPLY_END,
    payload: { text: read.value.text, reason: read.value.reason },
  });
}

/** 启动即握手：先问好，主进程据此判定存活。 */
io.attach();
io.send({ type: FRAME_TYPE.HELLO, traceId: 'trc_00000000', payload: { version: '1', pid: process.pid } });

/** 退出前尽力关浏览器，避免残留 chromium 进程。 */
process.on('SIGTERM', async () => {
  shotStream?.stop();
  for (const s of sessions.values()) await s.close();
  if (browser) await browser.close().catch(() => {});
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  log('error', 'unhandledRejection', { message: String(reason) });
});

log('info', 'worker started', { pid: process.pid });

/** 供单测引用（真实运行时不会用到）。 */
export const __internals = { err };
