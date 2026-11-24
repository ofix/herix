/**
 * 对话历史聚合：每 N 条（默认 10）一组，解决"几百条历史要滚很久"。
 * 一条 = 一次用户提问 + 一次模型回复（按会话条数算，不按消息算）。
 * @module ui/utils/chat-group
 */
export const GROUP_SIZE = 10;

/**
 * @param {{id:string,title:string,modelId:string,createdAt:string,updatedAt?:string}[]} conversations
 * @param {number} [size]
 * @returns {{ index:number, start:number, end:number, title:string, time:string, items:any[] }[]}
 */
export function groupConversations(conversations, size = GROUP_SIZE) {
  const list = (conversations ?? []).slice();
  const groups = [];
  for (let i = 0; i < list.length; i += size) {
    const items = list.slice(i, i + size);
    const start = i + 1;
    const end = i + items.length;
    const latest = items.reduce((acc, c) => (String(c.updatedAt ?? c.createdAt ?? '') > acc ? String(c.updatedAt ?? c.createdAt ?? '') : acc), '');
    groups.push({
      index: groups.length,
      start,
      end,
      title: start === end ? `第 ${start} 次对话` : `第 ${start}–${end} 次对话`,
      time: latest,
      items,
    });
  }
  return groups;
}

/**
 * 进度指示：当前可视起始条 / 总条数 → 百分比（0-100，保留 1 位）。
 * @param {number} startOneBased @param {number} total
 */
export function chatProgress(startOneBased, total) {
  if (!total || total <= 0) return { percent: 0, label: '0 / 0' };
  const start = Math.min(Math.max(startOneBased, 1), total);
  const percent = Math.max(0, Math.min(100, ((start - 1) / total) * 100));
  return { percent: Number(percent.toFixed(1)), label: `${start} / ${total}` };
}
