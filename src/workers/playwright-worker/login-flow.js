/**
 * LoginFlow：登录检测 + 可见窗口人工过验证码 + 登录态回收。
 * 不在 headless 里硬闯验证码 —— 一定会输；正确做法是把窗口交给人，程序只等信号。
 * @module workers/playwright-worker/login-flow
 */
import { ok, err } from '../../libs/utils/result.js';
import { ERROR_CODE } from '../../libs/utils/errors.js';
import { sleep } from '../../libs/utils/time.js';

/** @template T @typedef {import('../../libs/utils/result.js').Result<T>} Result */

/** 登录页的通用特征（不依赖具体站点文案）。 */
const LOGIN_HINTS = ['/login', 'passport', 'signin', 'sso'];

export class LoginFlow {
  /**
   * @param {object} deps
   * @param {import('./site-session.js').SiteSession} deps.session
   * @param {(level: string, message: string, fields?: object) => void} [deps.log]
   */
  constructor({ session, log = () => {} }) {
    this.session = session;
    this.log = log;
  }

  /**
   * 判定是否已登录：URL 不在登录页 + 输入框可用。
   * @returns {Promise<Result<{ loggedIn: boolean, evidence: string }>>}
   */
  async detect() {
    const page = this.session.page;
    if (!page) return err(ERROR_CODE.WORKER_DOWN, '会话未打开');
    const url = page.url().toLowerCase();
    if (LOGIN_HINTS.some((h) => url.includes(h))) {
      return ok({ loggedIn: false, evidence: `url=${url}` });
    }
    const loc = await this.session.locateInput();
    if (loc.ok) return ok({ loggedIn: true, evidence: `input=${loc.value.strategy}` });
    return ok({ loggedIn: false, evidence: 'no-input' });
  }

  /**
   * 交互式登录：把窗口交给用户，轮询到出现输入框为止。
   * @param {object} args
   * @param {(chunk: { stage: string }) => void} [args.onStage]
   * @param {AbortSignal} [args.signal]
   * @param {number} [args.timeoutMs]
   * @returns {Promise<Result<{ state: object }>>}
   */
  async runInteractive({ onStage = () => {}, signal, timeoutMs = 600_000 } = {}) {
    const page = this.session.page;
    if (!page) return err(ERROR_CODE.WORKER_DOWN, '会话未打开');
    onStage({ stage: 'awaiting-human' });
    try {
      await page.bringToFront();
    } catch {
      /* 无窗口环境忽略 */
    }

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (signal?.aborted) return err(ERROR_CODE.TIMEOUT, '登录被取消');
      await sleep(1500, signal).catch(() => {});
      const d = await this.detect();
      if (d.ok && d.value.loggedIn) {
        const state = await this.session.captureState();
        if (!state.ok) return state;
        onStage({ stage: 'logged-in' });
        return ok({ state: state.value });
      }
    }
    return err(ERROR_CODE.NOT_LOGGED_IN, `登录超时 ${Math.round(timeoutMs / 1000)}s`);
  }

  /**
   * 复用已有 storageState 打开站点后，确认登录仍有效；失效则返回 NOT_LOGGED_IN。
   * @returns {Promise<Result<{ valid: boolean }>>}
   */
  async verifyReuse() {
    const d = await this.detect();
    if (!d.ok) return d;
    if (!d.value.loggedIn) {
      return err(ERROR_CODE.NOT_LOGGED_IN, `登录态已失效（${d.value.evidence}）`, { retryable: true });
    }
    return ok({ valid: true });
  }
}
