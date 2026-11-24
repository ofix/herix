/**
 * SiteSession：一个站点 = 一个 BrowserContext + 一个 Page。**页面操作只允许从这里发出**。
 * 关键约束：
 *  - worker 不接触密钥文件：storageState 由主进程经帧下发 / 上行，加密由 SecretVault 负责
 *  - 同一站点同一时刻只有一个 session（由主进程 SiteQueue 保证，此处只做防御性断言）
 * @module workers/playwright-worker/site-session
 */
import { ok, err } from '../../libs/utils/result.js';
import { ERROR_CODE } from '../../libs/utils/errors.js';
import { sleep } from '../../libs/utils/time.js';
import { parse, healingChain } from './element-parser.js';
import { ReplyAssembler } from './reply-assembler.js';

/** @template T @typedef {import('../../libs/utils/result.js').Result<T>} Result */
/** @typedef {import('../../libs/schemas/site.schema.js').SiteConfigSchema} SiteConfig */
/** @typedef {import('./element-parser.js').DomNode} DomNode */

/** 页面内探针：收集可见的可交互元素，产出扁平快照（JSON 可序列化）。 */
export function domProbe() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const pathOf = (el) => {
    const seg = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && seg.length < 6) {
      let i = 1;
      let sib = cur.previousElementSibling;
      while (sib) {
        if (sib.tagName === cur.tagName) i += 1;
        sib = sib.previousElementSibling;
      }
      seg.unshift(`${cur.tagName.toLowerCase()}${i > 1 ? `:nth-of-type(${i})` : ''}`);
      cur = cur.parentElement;
    }
    return seg.join(' > ');
  };
  const sel = 'textarea,input,button,a,[role=textbox],[role=button],[contenteditable=true]';
  const out = [];
  for (const raw of Array.from(document.querySelectorAll(sel))) {
    const el = /** @type {any} */ (raw);
    if (!visible(el)) continue;
    out.push({
      tag: el.tagName.toLowerCase(),
      visible: true,
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      id: el.id || undefined,
      testId: el.getAttribute('data-testid') || undefined,
      role: el.getAttribute('role') || undefined,
      name: el.getAttribute('aria-label') || el.getAttribute('placeholder') || (el.innerText || '').trim().slice(0, 40) || undefined,
      text: (el.innerText || '').trim().slice(0, 120) || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      type: el.getAttribute('type') || undefined,
      path: pathOf(el),
    });
  }
  return out;
}

export class SiteSession {
  /**
   * @param {object} deps
   * @param {import('playwright-core').Browser} deps.browser
   * @param {any} deps.site 站点配置（已过 SiteConfigSchema）
   * @param {(level: string, message: string, fields?: object) => void} [deps.log]
   */
  constructor({ browser, site, log = () => {} }) {
    this.browser = browser;
    this.site = site;
    this.log = log;
    /** @type {import('playwright-core').BrowserContext | null} */
    this.context = null;
    /** @type {import('playwright-core').Page | null} */
    this.page = null;
    this.openedAt = 0;
  }

  /**
   * @param {{ interactive?: boolean, storageState?: object }} [opts]
   * @returns {Promise<Result<{ url: string }>>}
   */
  async open(opts = {}) {
    if (this.context) return err(ERROR_CODE.VALIDATION, `站点 ${this.site.id} 已有活动会话`);
    try {
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 900 },
        locale: 'zh-CN',
        storageState: opts.storageState ?? undefined,
        ...(opts.interactive ? { headless: false } : {}),
      });
      await this.context.route('**/*', (route) => {
        const type = route.request().resourceType();
        // 省流：图片/字体在非登录态一律拦掉，回复区是文本，视觉素材不影响判定
        if (['image', 'font', 'media'].includes(type)) return route.abort();
        return route.continue();
      });
      this.page = await this.context.newPage();
      this.page.setDefaultTimeout(20_000);
      await this.page.goto(this.site.loginUrl ?? this.site.url, { waitUntil: 'domcontentloaded' });
      this.openedAt = Date.now();
      return ok({ url: this.page.url() });
    } catch (e) {
      await this.close();
      return err(ERROR_CODE.WORKER_DOWN, `站点打开失败: ${/** @type {Error} */ (e).message}`, { retryable: true });
    }
  }

  /**
   * @returns {Promise<Result<DomNode[]>>}
   */
  async snapshotDom() {
    if (!this.page) return err(ERROR_CODE.WORKER_DOWN, '会话未打开');
    try {
      const nodes = await this.page.evaluate(domProbe);
      return ok(/** @type {DomNode[]} */ (nodes));
    } catch (e) {
      return err(ERROR_CODE.TIMEOUT, `DOM 快照失败: ${/** @type {Error} */ (e).message}`, { retryable: true });
    }
  }

  /**
   * 定位输入框：优先 yaml 里的 selector，失效则用 ElementParser 自愈。
   * @returns {Promise<Result<{ selector: string, strategy: string }>>}
   */
  async locateInput() {
    const configured = this.site.selectors?.input;
    if (configured && (await this.page?.$(configured))) {
      return ok({ selector: configured, strategy: 'yaml' });
    }
    const snap = await this.snapshotDom();
    if (!snap.ok) return snap;
    const parsed = parse(snap.value, { kinds: ['input'] });
    if (!parsed.ok || parsed.value.length === 0) {
      return err(ERROR_CODE.TOOL_MISSING, `找不到输入框 (${this.site.id})`);
    }
    const best = parsed.value[0];
    const heal = healingChain(configured ?? '', snap.value, { kind: 'input' });
    const selector = heal.ok && heal.value[0] ? heal.value[0].selector : `[placeholder="${best.node.placeholder ?? ''}"]`;
    return ok({ selector, strategy: heal.ok ? 'healed' : 'semantic' });
  }

  /**
   * 下发 prompt：fill + Enter（站点若有 send 按钮则点击）。
   * @param {string} text
   * @returns {Promise<Result<{ sentAt: number, selector: string }>>}
   */
  async sendPrompt(text) {
    if (!this.page) return err(ERROR_CODE.WORKER_DOWN, '会话未打开');
    if (!text || text.length > 200_000) return err(ERROR_CODE.VALIDATION, 'prompt 为空或超长');
    const loc = await this.locateInput();
    if (!loc.ok) return loc;
    try {
      await this.page.fill(loc.value.selector, '');
      await this.page.type(loc.value.selector, text, { delay: 12 }); // 逐字输入，模拟人类节奏
      const sendSelector = this.site.selectors?.send;
      if (sendSelector && (await this.page.$(sendSelector))) await this.page.click(sendSelector);
      else await this.page.press(loc.value.selector, 'Enter');
      return ok({ sentAt: Date.now(), selector: loc.value.selector });
    } catch (e) {
      return err(ERROR_CODE.TIMEOUT, `下发失败: ${/** @type {Error} */ (e).message}`, {
        retryable: true,
        detail: { selector: loc.value.selector },
      });
    }
  }

  /**
   * 读回复：轮询回复区文本 → 喂 ReplyAssembler → 事件回调。
   * @param {object} args
   * @param {string} args.traceId
   * @param {(chunk: string) => void} args.onChunk
   * @param {AbortSignal} [args.signal]
   * @param {{ idleMs?: number, pollMs?: number, hardTimeoutMs?: number }} [args.opts]
   * @returns {Promise<Result<{ text: string, reason: string }>>}
   */
  async readReply({ traceId, onChunk, signal, opts = {} }) {
    if (!this.page) return err(ERROR_CODE.WORKER_DOWN, '会话未打开');
    const assembler = new ReplyAssembler(opts).start(Date.now());
    const pollMs = opts.pollMs ?? 300;
    const replySel = this.site.selectors?.reply;
    let lastSent = '';
    while (!assembler.snapshot().done) {
      if (signal?.aborted) return err(ERROR_CODE.TIMEOUT, `读取被取消 (${traceId})`);
      await sleep(pollMs, signal).catch(() => {});
      let text = '';
      try {
        text = replySel ? ((await this.page.textContent(replySel)) ?? '') : '';
      } catch {
        text = ''; // 元素短暂消失属正常（重渲染）
      }
      if (!text) {
        const snap = await this.snapshotDom();
        if (snap.ok) {
          const healed = healingChain(replySel ?? '', snap.value);
          if (healed.ok && healed.value[0]) {
            try {
              text = (await this.page.textContent(healed.value[0].selector)) ?? '';
            } catch {
              text = '';
            }
          }
        }
      }
      const res = assembler.feed(text, Date.now());
      if (res.appended && res.appended !== lastSent) {
        lastSent = res.appended;
        onChunk(/** @type {string} */ (res.appended));
      }
      assembler.tick(Date.now());
    }
    const snap = assembler.snapshot();
    return ok({ text: snap.text, reason: String(snap.reason) });
  }

  /**
   * 上行 storageState 供主进程加密保存。**worker 不写任何密钥文件**。
   * @returns {Promise<Result<object>>}
   */
  async captureState() {
    if (!this.context) return err(ERROR_CODE.WORKER_DOWN, '会话未打开');
    try {
      return ok(await this.context.storageState());
    } catch (e) {
      return err(ERROR_CODE.STORE_IO, `导出登录态失败: ${/** @type {Error} */ (e).message}`, { retryable: true });
    }
  }

  /**
   * @returns {Promise<void>}
   */
  async close() {
    const ctx = this.context;
    this.context = null;
    this.page = null;
    if (ctx) await ctx.close().catch(() => {});
  }
}
