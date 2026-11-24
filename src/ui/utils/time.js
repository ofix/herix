/**
 * 对话时间展示：存储永远是 ISO 字符串，展示层本地化（豆包桌面版风格）。
 * 规则：今天 → "HH:mm"；昨天 → "昨天 HH:mm"；同年 → "MM-DD HH:mm"；跨年 → "YYYY-MM-DD HH:mm"。
 * @module ui/utils/time
 */
export function formatChatTime(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);
  if (diffDays === 0) return hm;
  if (diffDays === 1) return `昨天 ${hm}`;
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

/** 相对时间（终端/输出日志用） */
export function formatClock(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
