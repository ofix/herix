/**
 * ElementParser：把 page.evaluate 回来的「扁平 DOM 快照」解析成可交互元素，并生成 selector。
 * 纯函数、不碰浏览器对象 —— 因此在主进程与 worker 里都能单测。
 * 与 core/model-io/output-extractor 无关：这里只处理 DOM，不处理模型输出。
 * @module workers/playwright-worker/element-parser
 */
import { ok, err } from '../../libs/utils/result.js';
import { ERROR_CODE } from '../../libs/utils/errors.js';

/** @template T @typedef {import('../../libs/utils/result.js').Result<T>} Result */

/**
 * @typedef {object} DomNode  由页面内探针脚本产出的最小快照
 * @property {string} tag
 * @property {boolean} visible
 * @property {boolean} [disabled]
 * @property {string} [id]
 * @property {string} [testId]
 * @property {string} [role]
 * @property {string} [name]        可访问名 / aria-label / placeholder
 * @property {string} [text]        可见文本（截断 120 字符）
 * @property {string} [placeholder]
 * @property {string} [type]        input 的 type
 * @property {string} path          nth-child 路径，兜底 selector
 */

/**
 * @typedef {object} ParsedElement
 * @property {DomNode} node
 * @property {'input'|'button'|'editable'|'link'|'other'} kind
 * @property {number} score          可选性置信度 0–100
 */

/** 不稳定 id 的特征：含长数字串或框架生成前缀。 */
const UNSTABLE_ID = /(:\d|react-|el-id-|\d{6,}|[0-9a-f]{16,})/;

/**
 * @param {DomNode} node
 * @returns {'input'|'button'|'editable'|'link'|'other'}
 */
export function classify(node) {
  if (node.role === 'textbox') return 'input';
  if (node.role === 'button') return 'button';
  if (node.tag === 'textarea') return 'input';
  if (node.tag === 'input') return node.type === 'submit' || node.type === 'button' ? 'button' : 'input';
  if (node.tag === 'button') return 'button';
  if (node.tag === 'a') return 'link';
  return 'other';
}

/**
 * 按优先级生成 selector：testId > 稳定 id > role+name > placeholder > path。
 * @param {DomNode} node
 * @returns {{ selector: string, strategy: string, score: number }}
 */
export function generate(node) {
  if (node.testId) return { selector: `[data-testid="${esc(node.testId)}"]`, strategy: 'testId', score: 95 };
  if (node.id && !UNSTABLE_ID.test(node.id)) return { selector: `#${node.id}`, strategy: 'id', score: 90 };
  if (node.role && node.name) return { selector: `role=${node.role}[name="${esc(node.name)}"]`, strategy: 'role+name', score: 85 };
  if (node.placeholder) return { selector: `[placeholder="${esc(node.placeholder)}"]`, strategy: 'placeholder', score: 80 };
  if (node.name && node.tag) return { selector: `${node.tag}[aria-label="${esc(node.name)}"]`, strategy: 'aria-label', score: 70 };
  if (node.path) return { selector: node.path, strategy: 'path', score: 40 };
  return { selector: '', strategy: 'none', score: 0 };
}

/**
 * @param {DomNode[]} snapshot
 * @param {{ kinds?: Array<ParsedElement['kind']> }} [filter]
 * @returns {Result<ParsedElement[]>} 只返回可见、可用、有 selector 的元素，按分数降序
 */
export function parse(snapshot, filter = {}) {
  if (!Array.isArray(snapshot)) {
    return err(ERROR_CODE.VALIDATION, 'snapshot 必须是数组');
  }
  const out = [];
  for (const node of snapshot) {
    if (!node || !node.visible || node.disabled) continue;
    const kind = classify(node);
    if (filter.kinds && !filter.kinds.includes(kind)) continue;
    const g = generate(node);
    if (!g.selector) continue;
    out.push({ node, kind, score: g.score });
  }
  out.sort((a, b) => b.score - a.score);
  return ok(out);
}

/**
 * 自愈：原 selector 失效时，从新快照里找出语义最接近的元素，返回候选链（高→低）。
 * @param {string} failedSelector
 * @param {DomNode[]} snapshot
 * @param {{ kind?: ParsedElement['kind'] }} [hint]
 * @returns {Result<Array<{ selector: string, strategy: string, score: number }>>}
 */
export function healingChain(failedSelector, snapshot, hint = {}) {
  const parsed = parse(snapshot, hint.kind ? { kinds: [hint.kind] } : {});
  if (!parsed.ok) return parsed;

  const tokens = tokenize(failedSelector);
  const scored = parsed.value
    .map((el) => {
      const g = generate(el.node);
      const text = `${el.node.text ?? ''} ${el.node.name ?? ''} ${el.node.placeholder ?? ''}`.toLowerCase();
      const hit = tokens.filter((t) => text.includes(t) || (el.node.id ?? '').includes(t)).length;
      return { ...g, score: Math.min(100, g.score * 0.6 + hit * 10) };
    })
    .filter((c) => c.selector && c.selector !== failedSelector)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return err(ERROR_CODE.VALIDATION, `自愈失败：快照中无候选元素 (${failedSelector})`);
  }
  return ok(scored.slice(0, 5));
}

/**
 * 从 selector 里抽可比较的词（去掉符号与过短词）。
 * @param {string} selector
 * @returns {string[]}
 */
export function tokenize(selector) {
  return String(selector)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
}

function esc(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
