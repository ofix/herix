/**
 * RoundRunner：跑一轮会议并发请求，带硬超时与单模型降级。
 * 关键：超时不是"整体失败"，而是把落后者剔除后继续 —— 会议的价值在多数意见，不在全票。
 * @module main/core/conference/round-runner
 */
import { ok, err } from '../../../libs/utils/result.js';
import { ERROR_CODE } from '../../../libs/utils/errors.js';

/**
 * @typedef {{ siteId: string, role: string, text: string, ms: number }} RoundReply
 * @typedef {{ ok: boolean, value?: RoundReply, error?: any }} Settled
 */

export class RoundRunner {
  /**
   * @param {{ timeoutMs?: number, minParticipants?: number, concurrency?: number }} [opts]
   */
  constructor(opts = {}) {
    this.timeoutMs = opts.timeoutMs ?? 120000;
    this.minParticipants = opts.minParticipants ?? 2;
    this.concurrency = Math.min(opts.concurrency ?? 4, 4);
  }

  /**
   * @param {{ participants: {siteId:string,role:string}[], prompt: string, send: (p:any, prompt:string) => Promise<string>, onProgress?: (p:any)=>void }} args
   * @returns {Promise<import('../../../libs/utils/result.js').Result<{ replies: RoundReply[], failed: {siteId:string,reason:string}[], degraded: boolean, elapsedMs: number }>>}
   */
  async runRound({ participants, prompt, send, onProgress = () => {} }) {
    const t0 = Date.now();
    const batch = participants.slice(0, this.concurrency);
    /** @type {{siteId:string,reason:string}[]} */
    const failed = [];

    const tasks = batch.map(async (p) => {
      const started = Date.now();
      try {
        const text = await withTimeout(send(p, prompt), this.timeoutMs, p.siteId);
        onProgress(p);
        return /** @type {RoundReply} */ ({ siteId: p.siteId, role: p.role, text: String(text ?? ''), ms: Date.now() - started });
      } catch (e) {
        failed.push({ siteId: p.siteId, reason: /** @type {Error} */ (e).message });
        return null;
      }
    });

    const settled = (await Promise.all(tasks)).filter(Boolean);
    const replies = /** @type {RoundReply[]} */ (settled);
    const elapsedMs = Date.now() - t0;

    if (replies.length < this.minParticipants) {
      return err(ERROR_CODE.CONFERENCE_NO_QUORUM, `本轮仅 ${replies.length} 个模型响应（需 >= ${this.minParticipants}）`, {
        detail: { failed, elapsedMs, retryable: true },
      });
    }
    return ok({ replies, failed, degraded: replies.length < batch.length, elapsedMs });
  }
}

/**
 * @template T @param {Promise<T>} p @param {number} ms @param {string} label @returns {Promise<T>}
 */
export function withTimeout(p, ms, label) {
  /** @type {any} */
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`站点 ${label} 超时 ${ms}ms`)), ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer));
}
