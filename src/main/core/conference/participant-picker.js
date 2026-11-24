/**
 * ParticipantPicker：会议参会者挑选。硬上限 4 人（规约）。
 * 原则：① 角色不重复（实现/审查/测试/架构各一人）② 站点不重复（一站一会话）
 * ③ 同一角色优先选与上一轮结论分歧最大的（本轮暂用 failureStreak 低的优先）④ 缺角色时降级为可用角色。
 * @module main/core/conference/participant-picker
 */
import { ok, err } from '../../../libs/utils/result.js';
import { ERROR_CODE } from '../../../libs/utils/errors.js';

export const MAX_PARTICIPANTS = 4;

/** @typedef {{ siteId: string, role: string, skillId: string, health?: any }} Candidate */

export class ParticipantPicker {
  /** @param {{ max?: number, requiredRoles?: string[] }} [opts] */
  constructor(opts = {}) {
    this.max = Math.min(opts.max ?? MAX_PARTICIPANTS, MAX_PARTICIPANTS);
    this.defaultRoles = opts.requiredRoles ?? ['implementer', 'reviewer', 'tester'];
  }

  /**
   * @param {{ candidates: Candidate[], requiredRoles?: string[] }} args
   * @returns {import('../../../libs/utils/result.js').Result<{ picked: Candidate[], missingRoles: string[], degraded: boolean }>}
   */
  pick({ candidates, requiredRoles }) {
    const roles = requiredRoles ?? this.defaultRoles;
    if (!candidates?.length) {
      return err(ERROR_CODE.CONFERENCE_NO_QUORUM, '没有可用候选站点');
    }
    const picked = [];
    const usedSites = new Set();
    const missingRoles = [];

    for (const role of roles) {
      if (picked.length >= this.max) break;
      const pool = candidates.filter((c) => c.role === role && !usedSites.has(c.siteId));
      if (pool.length === 0) {
        missingRoles.push(role);
        continue;
      }
      pool.sort((a, b) => (a.health?.failureStreak ?? 0) - (b.health?.failureStreak ?? 0));
      const chosen = pool[0];
      usedSites.add(chosen.siteId);
      picked.push(chosen);
    }

    // 角色覆盖不足时，用剩余站点补位（记为 degraded，票权降为 0.5）
    const degraded = missingRoles.length > 0;
    if (picked.length < 2) {
      for (const c of candidates) {
        if (picked.length >= 2) break;
        if (usedSites.has(c.siteId)) continue;
        usedSites.add(c.siteId);
        picked.push(c);
      }
    }
    if (picked.length < 2) {
      return err(ERROR_CODE.CONFERENCE_NO_QUORUM, `可用站点不足 2 个（${picked.length}），无法成会`, {
        detail: { missingRoles },
      });
    }
    return ok({ picked, missingRoles, degraded });
  }

  /**
   * 补充轮次的参会者（保持角色覆盖，替换掉上一轮失败的）。
   * @param {{ picked: Candidate[], failedSiteIds: string[], candidates: Candidate[] }} args
   */
  refill({ picked, failedSiteIds, candidates }) {
    const alive = picked.filter((p) => !failedSiteIds.includes(p.siteId));
    const usedSites = new Set(alive.map((p) => p.siteId));
    for (const p of picked) {
      if (alive.length >= 2) break;
      if (!failedSiteIds.includes(p.siteId)) continue;
      const sub = candidates.find((c) => c.role === p.role && !usedSites.has(c.siteId));
      if (sub) {
        alive.push(sub);
        usedSites.add(sub.siteId);
      }
    }
    return ok({ picked: alive });
  }
}
