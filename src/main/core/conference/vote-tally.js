/**
 * VoteTally：会议投票统计。
 * 规则：① 按结论指纹（归一化后的前 N 字符哈希）聚类 ② 得票最多者胜
 * ③ 平票时：若含"更保守"标记（有 patch 的优先）则保守胜，否则判 tie 交人工
 * ④ degraded 参会者票权 0.5。
 * @module main/core/conference/vote-tally
 */
import { ok, err } from '../../../libs/utils/result.js';
import { ERROR_CODE } from '../../../libs/utils/errors.js';

/**
 * @typedef {{ siteId: string, text: string, weight?: number, hasPatch?: boolean }} Vote
 * @typedef {{ key: string, label: string, weight: number, voters: string[], hasPatch?: boolean }} Bucket
 */

/**
 * 归一化：去空白、去标点、小写、取前 40 字 —— 同义表述不该被拆成两票。
 * @param {string} text
 */
export function fingerprint(text) {
  const norm = String(text ?? '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .slice(0, 40);
  return norm || '(empty)';
}

export class VoteTally {
  /** @param {{ quorum?: number, tieBreaker?: 'conservative'|'human' }} [opts] */
  constructor(opts = {}) {
    this.quorum = opts.quorum ?? 2;
    this.tieBreaker = opts.tieBreaker ?? 'conservative';
  }

  /**
   * @param {Vote[]} votes
   * @returns {import('../../../libs/utils/result.js').Result<{ winner: Bucket|null, buckets: Bucket[], tie: boolean, totalWeight: number }>}
   */
  tally(votes) {
    if (!votes?.length) return err(ERROR_CODE.CONFERENCE_NO_QUORUM, '无投票');
    /** @type {Map<string, Bucket>} */
    const map = new Map();
    for (const v of votes) {
      const key = fingerprint(v.text);
      const w = v.weight ?? 1;
      const b = map.get(key) ?? { key, label: v.text, weight: 0, voters: [] };
      b.weight += w;
      b.voters.push(v.siteId);
      if (v.hasPatch) b.hasPatch = true;
      map.set(key, b);
    }
    const buckets = [...map.values()].sort((a, b) => b.weight - a.weight);
    const totalWeight = buckets.reduce((s, b) => s + b.weight, 0);

    const top = buckets[0];
    const second = buckets[1];
    const tie = Boolean(second && Math.abs(top.weight - second.weight) < 1e-9);

    if (tie) {
      if (this.tieBreaker === 'human') return ok({ winner: null, buckets, tie: true, totalWeight });
      const conservative = top.hasPatch ? top : second.hasPatch ? second : null;
      if (conservative) return ok({ winner: conservative, buckets, tie: true, totalWeight });
      return ok({ winner: null, buckets, tie: true, totalWeight });
    }
    if (top.voters.length < this.quorum && top.weight < 2) {
      return ok({ winner: top, buckets, tie: false, totalWeight });
    }
    return ok({ winner: top, buckets, tie: false, totalWeight });
  }
}
