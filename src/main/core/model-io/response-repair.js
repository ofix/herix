/**
 * ResponseRepair：畸形输出修复 + 有限重试。
 * 网页模型常见的 6 类畸形：① fence 未闭合 ② 前言杂话 ③ 全角标点 ④ JSON 尾逗号 ⑤ diff 被包裹成 json
 * ⑥ 输出被截断。修复优先于重试 —— 重试要付一次完整网页往返（30s+），修复是本地零成本。
 * @module main/core/model-io/response-repair
 */
import { ok, err } from '../../../libs/utils/result.js';
import { ERROR_CODE } from '../../../libs/utils/errors.js';

/** @typedef {'close-fence'|'strip-preamble'|'unwrap-diff'|'normalize-quotes'|'trim-tail'|'none'} RepairAction */

export class ResponseRepair {
  /**
   * @param {{ maxAttempts?: number, extractStrict?: (raw: string, req?: any) => any }} [opts]
   */
  constructor(opts = {}) {
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.extractStrict = opts.extractStrict;
    this.stats = { attempted: 0, repaired: 0, failed: 0 };
  }

  /**
   * 本地修复一轮（幂等、可叠加）。
   * @param {string} raw
   * @param {{ needDiff?: boolean, needJson?: boolean }} req
   * @returns {{ text: string, actions: RepairAction[] }}
   */
  repairOnce(raw, req = {}) {
    let text = String(raw ?? '');
    /** @type {RepairAction[]} */
    const actions = [];

    // 全角引号：仅在需要 JSON 时收敛，否则会破坏正文语义
    if (req.needJson) {
      const t = text.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
      if (t !== text) {
        text = t;
        actions.push('normalize-quotes');
      }
    }

    // fence 计数为奇数 → 补尾
    const fences = (text.match(/```/g) ?? []).length;
    if (fences % 2 === 1) {
      text = `${text.trimEnd()}\n\`\`\`\n`;
      actions.push('close-fence');
    }

    // 前言：第一个 fence 之前若有 > 200 字且含"好的/以下是/我将"则剥掉
    const firstFence = text.indexOf('```');
    if (firstFence > 0) {
      const head = text.slice(0, firstFence);
      if (head.length > 200 && /好的|以下是|我将|下面是|Here is/i.test(head)) {
        text = text.slice(firstFence);
        actions.push('strip-preamble');
      }
    }

    // diff 被塞进 json 字符串里
    if (req.needDiff && !text.includes('```diff')) {
      const m = /```json[ \t]*\r?\n([\s\S]*?)```/.exec(text);
      const body = m?.[1] ?? '';
      if (body.includes('--- a/') || body.includes('"diff"')) {
        const inner = body.includes('"diff"') ? safeJsonString(body, 'diff') : body;
        if (inner) {
          // 追加而不是替换：原 json 块里的 summary/confidence 仍要保留给下游
          text = `${text.trimEnd()}\n\`\`\`diff\n${inner.replace(/\\n/g, '\n')}\n\`\`\`\n`;
          actions.push('unwrap-diff');
        }
      }
    }

    // JSON 尾逗号 / 尾随垃圾
    if (req.needJson) {
      const t = text.replace(/,\s*([}\]])/g, '$1').replace(/,{2,}/g, ',');
      if (t !== text) {
        text = t;
        actions.push('trim-tail');
      }
    }

    if (actions.length === 0) actions.push('none');
    return { text, actions };
  }

  /**
   * 带重试的取产物：修复 → 校验 → 失败则重取（最多 maxAttempts 次完整往返）。
   * @param {{ fetch: () => Promise<string>, req?: { needDiff?: boolean, needJson?: boolean } }} args
   * @returns {Promise<any>}
   */
  async fetchAndRepair({ fetch, req = {} }) {
    this.stats.attempted += 1;
    let lastErr = null;
    for (let i = 0; i < this.maxAttempts; i += 1) {
      const raw = await fetch();
      const fixed = this.repairOnce(raw, req);
      const checked = this.extractStrict
        ? this.extractStrict(fixed.text, req)
        : ok({ text: fixed.text, actions: fixed.actions });
      if (checked.ok) {
        if (i > 0 || fixed.actions[0] !== 'none') this.stats.repaired += 1;
        return ok({ ...checked.value, actions: fixed.actions, attempts: i + 1 });
      }
      lastErr = checked.error;
    }
    this.stats.failed += 1;
    return err(ERROR_CODE.PATCH_PARSE, `连续 ${this.maxAttempts} 次未能救回输出`, {
      detail: lastErr?.message,
    });
  }

  /** @returns {{ attempted: number, repaired: number, failed: number, rate: number }} */
  snapshot() {
    const { attempted, repaired, failed } = this.stats;
    return { attempted, repaired, failed, rate: attempted ? repaired / attempted : 0 };
  }
}

/**
 * 从 JSON 文本里取某个字符串字段（用于 "diff" 包裹场景）。
 * @param {string} body @param {string} key @returns {string|null}
 */
function safeJsonString(body, key) {
  try {
    const o = JSON.parse(body);
    return typeof o?.[key] === 'string' ? o[key] : null;
  } catch {
    return null;
  }
}
