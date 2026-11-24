/**
 * Scheduler：选站策略。纯决策 —— 读健康度与队列深度，不改状态。
 * 优先级：skill 白名单 → 未熔断 → 未冷却 → 队列最短 → 站点声明优先级。
 * @module main/core/scheduler
 */
import { ok, err } from '../../libs/utils/result.js';
import { ERROR_CODE } from '../../libs/utils/errors.js';
import { SITE_STATE } from '../../libs/contracts/domain.js';

/** @template T @typedef {import('../../libs/utils/result.js').Result<T>} Result */

/** @typedef {{ id: string, state: string, queueDepth: number, cooldownUntil?: string, failureStreak?: number, priority?: number }} SiteHealth */

export class Scheduler {
  /**
   * @param {{ maxFailureStreak?: number, clock?: () => number }} [opts]
   */
  constructor(opts = {}) {
    this.maxFailureStreak = opts.maxFailureStreak ?? 3;
    this.clock = opts.clock ?? (() => Date.now());
  }

  /**
   * @param {string} siteId
   * @param {SiteHealth} h
   * @returns {boolean} 是否熔断（连续失败超限）
   */
  shouldCircuitBreak(siteId, h) {
    void siteId;
    return (h.failureStreak ?? 0) >= this.maxFailureStreak;
  }

  /**
   * @param {{ skillId: string, candidates: SiteHealth[], allowedSites?: string[] }} args
   * @returns {Result<{ siteId: string, reason: string }>}
   */
  selectSite({ skillId, candidates, allowedSites = [] }) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return err(ERROR_CODE.VALIDATION, `SKILL ${skillId} 没有候选站点`);
    }
    const eligible = candidates.filter((c) => {
      if (allowedSites.length && !allowedSites.includes(c.id)) return false;
      if (c.state === SITE_STATE.UNAVAILABLE || c.state === SITE_STATE.LOGGED_OUT) return false;
      if (this.shouldCircuitBreak(c.id, c)) return false;
      if (c.cooldownUntil && Date.parse(c.cooldownUntil) > this.clock()) return false;
      return true;
    });

    if (eligible.length === 0) {
      return err(ERROR_CODE.VALIDATION, `SKILL ${skillId} 的所有站点均不可用（熔断/冷却/未登录）`, {
        retryable: true,
        detail: { candidates: candidates.map((c) => `${c.id}:${c.state}`) },
      });
    }

    eligible.sort((a, b) => (a.queueDepth ?? 0) - (b.queueDepth ?? 0) || (a.priority ?? 5) - (b.priority ?? 5));
    const best = eligible[0];
    return ok({ siteId: best.id, reason: `queue=${best.queueDepth ?? 0},state=${best.state}` });
  }

  /**
   * 顺序尝试：选站失败时返回候选顺序，供上层逐个降级。
   * @param {{ skillId: string, candidates: SiteHealth[], allowedSites?: string[] }} args
   * @returns {Result<string[]>}
   */
  rankSites({ skillId, candidates, allowedSites = [] }) {
    const ordered = candidates
      .filter((c) => !allowedSites.length || allowedSites.includes(c.id))
      .filter((c) => c.state !== SITE_STATE.UNAVAILABLE && c.state !== SITE_STATE.LOGGED_OUT)
      .filter((c) => !this.shouldCircuitBreak(c.id, c))
      .sort((a, b) => (a.queueDepth ?? 0) - (b.queueDepth ?? 0) || (a.priority ?? 5) - (b.priority ?? 5))
      .map((c) => c.id);
    if (ordered.length === 0) {
      return err(ERROR_CODE.VALIDATION, `SKILL ${skillId} 无可用站点`, { retryable: true });
    }
    return ok(ordered);
  }
}
