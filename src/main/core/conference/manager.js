/**
 * ConferenceManager：多模型会议编排。
 * 硬约束（规约）：参会 ≤4、轮次 ≤2、单轮 120s 超时降级单模型、无法定人数（<2）直接放弃。
 * 编排顺序：选人 → 第一轮并发 → 互评（把别人结论注入第二轮）→ 投票 → 产出决议。
 * @module main/core/conference/manager
 */
import { ok, err } from '../../../libs/utils/result.js';
import { ERROR_CODE } from '../../../libs/utils/errors.js';
import { ParticipantPicker } from './participant-picker.js';
import { RoundRunner } from './round-runner.js';
import { VoteTally, fingerprint } from './vote-tally.js';

/** @template T @typedef {import('../../../libs/utils/result.js').Result<T>} Result */

export class ConferenceManager {
  /**
   * @param {object} deps
   * @param {(p:any, prompt:string)=>Promise<string>} deps.send
   * @param {ParticipantPicker} [deps.picker] @param {RoundRunner} [deps.runner] @param {VoteTally} [deps.tally]
   * @param {number} [deps.maxRounds] @param {(msg:string)=>void} [deps.log]
   */
  constructor(deps) {
    this.send = deps.send;
    this.picker = deps.picker ?? new ParticipantPicker();
    this.runner = deps.runner ?? new RoundRunner();
    this.tally = deps.tally ?? new VoteTally();
    this.maxRounds = Math.min(deps.maxRounds ?? 2, 2);
    this.log = deps.log ?? (() => {});
  }

  /**
   * @param {{ topic: string, candidates: any[], requiredRoles?: string[], ctx?: any }} args
   * @returns {Promise<Result<{ confId: string, rounds: any[], decision: any, degraded: boolean }>>}
   */
  async run({ topic, candidates, requiredRoles, ctx }) {
    const picked = this.picker.pick({ candidates, requiredRoles });
    if (!picked.ok) return picked;
    const { picked: participants, degraded } = picked.value;
    this.log(`会议 ${topic} 参会 ${participants.length} 人（degraded=${degraded}）`);

    /** @type {any[]} */
    const rounds = [];
    for (let i = 0; i < this.maxRounds; i += 1) {
      const prompt = i === 0 ? topic : buildPeerPrompt(topic, rounds[i - 1].replies);
      const r = await this.runner.runRound({ participants, prompt, send: this.send });
      if (!r.ok) {
        if (i === 0) return err(ERROR_CODE.CONFERENCE_NO_QUORUM, '首轮无法凑齐法定人数', { detail: r.error });
        this.log(`第 ${i + 1} 轮失败，沿用上一轮结论`);
        break;
      }
      rounds.push(r.value);
      // 第二轮后若已一致则提前结束
      if (i > 0 && this._agree(rounds[i]) >= 0.8) break;
    }

    const last = rounds[rounds.length - 1];
    const t = this.tally.tally(
      last.replies.map((rep) => ({
        siteId: rep.siteId,
        text: rep.text.slice(0, 2000),
        weight: degraded ? 0.5 : 1,
        hasPatch: /```diff|```patch/.test(rep.text),
      })),
    );
    if (!t.ok) return t;

    const decision = {
      winner: t.value.winner,
      tie: t.value.tie,
      buckets: t.value.buckets,
      /** 未取胜方观点保留为异议，供人工看 */
      dissent: t.value.buckets.slice(1).map((b) => ({ voters: b.voters, label: b.label.slice(0, 500) })),
    };
    return ok({ confId: `cnf_${String(ctx?.traceId ?? 'x').slice(4, 12)}`, rounds, decision, degraded });
  }

  /** @param {any} round @returns {number} 一致度（最大簇占比） */
  _agree(round) {
    if (!round?.replies?.length) return 0;
    const counts = new Map();
    for (const r of round.replies) {
      const k = fingerprint(r.text);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const max = Math.max(...counts.values());
    return max / round.replies.length;
  }
}

/**
 * 第二轮提示词：注入他人结论 + 要求互评（这就是"对抗幻觉"的机制）。
 * @param {string} topic
 * @param {any[]} prevReplies
 */
export function buildPeerPrompt(topic, prevReplies) {
  const peers = (prevReplies ?? [])
    .map((r, i) => `### 参会者${i + 1}（${r.role}@${r.siteId}）\n${String(r.text).slice(0, 3000)}`)
    .join('\n\n');
  return [
    `## 原任务\n${topic}`,
    `## 其他模型的结论\n${peers}`,
    '## 你的任务',
    '请逐条核对上面的结论：指出事实错误、遗漏的边界条件、以及你不同意之处。',
    '最后给出你自己的最终方案（保持要求的输出格式）。若赞同他人，必须说明你亲自验证了哪一点。',
  ].join('\n\n');
}
