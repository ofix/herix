/**
 * 艾特（@）模型 / 井号（#）代码引用的输入解析。
 * 规则：井号支持 "当前文件" 与函数签名；艾特支持多模型。
 * 解析结果用于：① 提交时告诉后端引用哪些位置 ② 输入框内高亮。
 * @module ui/utils/mention
 */
export const TOKEN_RE = /([@#])([\w\u4e00-\u9fa5./:-]*)/g;

/**
 * @param {string} text
 * @returns {{ models: string[], refs: { kind:'file'|'symbol', value:string }[], ranges: {start:number,end:number,char:string,value:string}[] }}
 */
export function parseMentions(text) {
  const src = String(text ?? '');
  const models = [];
  /** @type {{kind:'file'|'symbol', value:string}[]} */
  const refs = [];
  const ranges = [];
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(src)) !== null) {
    const value = m[2];
    if (!value) continue;
    ranges.push({ start: m.index, end: m.index + m[0].length, char: m[1], value });
    if (m[1] === '@') {
      if (!models.includes(value)) models.push(value);
    } else if (value.startsWith('file:')) {
      refs.push({ kind: 'file', value: value.slice(5) });
    } else {
      refs.push({ kind: 'symbol', value });
    }
  }
  return { models, refs, ranges };
}

/**
 * 触发中的 mention 片段：光标前最后一个艾特或井号之后、且不含空白的部分。
 * @param {string} text @param {number} [caret]
 */
export function activeTrigger(text, caret) {
  const src = String(text ?? '');
  const pos = caret ?? src.length;
  const before = src.slice(0, pos);
  const at = Math.max(before.lastIndexOf('@'), before.lastIndexOf('#'));
  if (at < 0) return null;
  const char = before[at];
  const tail = before.slice(at + 1);
  if (/\s/.test(tail)) return null;
  return { char, query: tail, start: at };
}

/**
 * 前缀匹配函数签名（大小写不敏感，最多 limit 条）。
 * @param {{name:string,file:string,line:number,signature?:string}[]} symbols
 * @param {string} query
 * @param {number} [limit]
 */
export function matchSymbols(symbols, query, limit = 8) {
  const q = String(query ?? '').toLowerCase();
  const list = (symbols ?? []).filter((s) => !q || s.name.toLowerCase().startsWith(q));
  return list.slice(0, limit);
}
