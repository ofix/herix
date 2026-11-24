/**
 * 会话标题的展示化处理：
 * - 去掉 mock/后端便于去重而附加的 `#序号` 后缀；
 * - 破折号/下划线拼接的 slug（如 `fix-null-pointer`）拆成词并首字母大写；
 * - 纯英文标题首字母大写，中文保持原样。
 * 仅影响展示，存储层仍保留原始 title。
 */
const SEQ_SUFFIX_RE = /\s*#\d+\s*$/;

/**
 * @param {string} raw 原始标题
 * @returns {string} 用于界面展示的标题
 */
export function humanizeTitle(raw) {
  const base = String(raw ?? '').replace(SEQ_SUFFIX_RE, '').trim();
  if (!base) return '未命名会话';
  if (/[\u4e00-\u9fa5]/.test(base)) return base;
  const words = base.split(/[-_]+/).filter(Boolean);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
