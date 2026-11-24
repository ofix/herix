/**
 * ReplyAssembler：把流式 chunk 拼成最终文本，并判定「这一轮是否结束」。
 * 判定四条件（任一满足即结束）：
 *   1) 站点信号：stop 按钮消失 / 出现「重新生成」（由 SiteSession 传 signalDone=true）
 *   2) 静默：文本在 idleMs 内无增长且非空
 *   3) 稳定：内容哈希连续 stableHits 次不变
 *   4) 硬超时：超过 hardTimeoutMs
 * 不做任何 I/O —— 时间由外部传入，可完全重放。
 * @module workers/playwright-worker/reply-assembler
 */

/**
 * @typedef {'signal'|'idle'|'stable'|'timeout'|null} DoneReason
 * @typedef {object} AssemblerState
 * @property {string} text
 * @property {number} chunks
 * @property {DoneReason} reason
 * @property {number} lastGrowthAt
 * @property {string} lastHash
 * @property {number} stableHits
 */

export class ReplyAssembler {
  /**
   * @param {{ idleMs?: number, stableHits?: number, hardTimeoutMs?: number }} [opts]
   */
  constructor(opts = {}) {
    this.idleMs = opts.idleMs ?? 4000;
    this.stableThreshold = opts.stableHits ?? 3;
    this.hardTimeoutMs = opts.hardTimeoutMs ?? 300_000;
    /** @type {AssemblerState} */
    this.state = {
      text: '',
      chunks: 0,
      reason: null,
      lastGrowthAt: 0,
      lastHash: '',
      stableHits: 0,
    };
    this.startedAt = 0;
  }

  /**
   * @param {number} now 由调用方注入（Date.now() 或测试假时钟）
   * @returns {this}
   */
  start(now) {
    this.startedAt = now;
    this.state.lastGrowthAt = now;
    return this;
  }

  /**
   * 喂一个流式分片。分片可能是「全量快照」而非增量——因此按最长公共前缀合并，
   * 这样站点用累积文本还是增量文本都能正确工作。
   * @param {string} chunk
   * @param {number} now
   * @returns {{ appended: string, done: boolean, reason: DoneReason }}
   */
  feed(chunk, now) {
    const incoming = typeof chunk === 'string' ? chunk : '';
    const appended = mergeSnapshot(this.state.text, incoming);
    if (appended.length > 0) {
      this.state.text += appended;
      this.state.chunks += 1;
      this.state.lastGrowthAt = now;
    }
    const hash = fnv1a(this.state.text);
    if (appended.length === 0 && this.state.lastHash === hash) this.state.stableHits += 1;
    else if (appended.length === 0) this.state.stableHits = Math.max(1, this.state.stableHits);
    else this.state.stableHits = 0;
    this.state.lastHash = hash;
    return { appended, done: this.tick(now), reason: this.state.reason };
  }

  /**
   * 仅推进时间（没有新分片时调用），用于静默判定。
   * @param {number} now
   * @returns {boolean} 是否已结束
   */
  tick(now) {
    if (this.state.reason) return true;
    if (now - this.startedAt >= this.hardTimeoutMs) {
      this.state.reason = 'timeout';
      return true;
    }
    if (this.state.text.length > 0 && now - this.state.lastGrowthAt >= this.idleMs) {
      this.state.reason = 'idle';
      return true;
    }
    if (this.state.text.length > 0 && this.state.stableHits >= this.stableThreshold) {
      this.state.reason = 'stable';
      return true;
    }
    return false;
  }

  /**
   * 站点显式信号（停止按钮消失 / 出现重新生成）。
   * @returns {boolean}
   */
  signalDone() {
    if (this.state.reason) return true;
    if (this.state.text.length === 0) return false; // 空回复不算结束，等超时或下一轮
    this.state.reason = 'signal';
    return true;
  }

  /**
   * @returns {{ text: string, chunks: number, done: boolean, reason: DoneReason }}
   */
  snapshot() {
    return { text: this.state.text, chunks: this.state.chunks, done: Boolean(this.state.reason), reason: this.state.reason };
  }
}

/**
 * 合并「累积快照」或「增量文本」：
 * - 若 incoming 以当前全文开头 → 属于累积快照，只取新增尾部
 * - 否则视为增量，直接追加
 * @param {string} current
 * @param {string} incoming
 * @returns {string} 需要追加的部分
 */
export function mergeSnapshot(current, incoming) {
  if (!incoming) return '';
  if (incoming === current) return '';
  if (incoming.length > current.length && incoming.startsWith(current)) return incoming.slice(current.length);
  if (current.length > incoming.length && current.startsWith(incoming)) return ''; // 迟到的旧快照
  return incoming;
}

/** FNV-1a 32 位：只用于「内容是否变化」的比较，不做安全用途。 */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

