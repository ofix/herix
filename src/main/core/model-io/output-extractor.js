/**
 * OutputExtractor：从网页模型回复里抽出结构化产物。
 * 网页回复不可控（前言、多余 markdown、fence 语言标错），因此解析必须「宽进严出」：
 * 识别 ```json / ```diff / ```(无语言) 三类块，找不到就整体当地文。
 * @module main/core/model-io/output-extractor
 */
import { ok, err } from '../../../libs/utils/result.js';
import { ERROR_CODE } from '../../../libs/utils/errors.js';

const FENCE_RE = /```([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)```/g;

/** @typedef {{ lang: string, body: string }} Fence */

export class OutputExtractor {
  /**
   * @param {string} raw
   * @returns {{ fences: Fence[], json: any|null, diff: string|null, plain: string, errors: string[] }}
   */
  extract(raw) {
    const text = String(raw ?? '');
    const fences = [];
    const errors = [];
    FENCE_RE.lastIndex = 0;
    let m;
    while ((m = FENCE_RE.exec(text)) !== null) {
      fences.push({ lang: (m[1] || '').toLowerCase(), body: m[2] });
    }
    // 未闭合的最后一个 fence（网页流式输出常被截断）
    if (text.includes('```') && fences.length === 0) {
      errors.push('fence-unclosed');
    }

    let json = null;
    let jsonErr = null;
    for (const f of fences) {
      if (f.lang === 'json' || f.lang === '') {
        const r = tryJson(f.body);
        if (r.ok) {
          json = r.value;
          break;
        }
        jsonErr = r.error.message;
      }
    }

    let diff = null;
    for (const f of fences) {
      if (f.lang === 'diff' || f.lang === 'patch') {
        diff = f.body;
        break;
      }
    }
    if (!diff && fences.length === 1 && fences[0].body.includes('--- a/')) {
      diff = fences[0].body;
    }
    if (jsonErr && !json) errors.push(`json:${jsonErr}`);

    const plain = text.replace(FENCE_RE, '').trim();
    return { fences, json, diff, plain, errors };
  }

  /**
   * 强校验：任务要求必须有 diff 时用这个。
   * @param {string} raw
   * @param {{ needDiff?: boolean, needJson?: boolean }} [req]
   */
  extractStrict(raw, req = {}) {
    const out = this.extract(raw);
    if (req.needJson && !out.json) {
      return err(ERROR_CODE.PATCH_PARSE, '缺少可解析的 JSON 结论块', { detail: out.errors });
    }
    if (req.needDiff && !out.diff) {
      return err(ERROR_CODE.PATCH_PARSE, '缺少 unified diff 块', { detail: out.errors });
    }
    if (req.needDiff && out.diff && !/^---\s+\S/m.test(out.diff)) {
      return err(ERROR_CODE.PATCH_PARSE, 'diff 缺少 --- a/ 头，无法应用');
    }
    return ok(out);
  }
}

/**
 * 宽松 JSON：去尾部逗号、全角引号、BOM、包裹壳。
 * @param {string} s
 */
export function tryJson(s) {
  const cleaned = String(s)
    .replace(/^\uFEFF/, '')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
  const candidates = [cleaned];
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1));
  for (const c of candidates) {
    try {
      return ok(JSON.parse(c));
    } catch {
      /* 试下一个 */
    }
  }
  return err(ERROR_CODE.PATCH_PARSE, 'JSON 不可解析');
}
