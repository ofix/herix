/**
 * SkillRegistry：SKILL 只读索引 + 角色匹配。数据来源是 ConfigResolver，本类不读文件。
 * @module main/core/registry/skill-registry
 */
import { ok, err } from '../../../libs/utils/result.js';
import { ERROR_CODE } from '../../../libs/utils/errors.js';

/** @template T @typedef {import('../../../libs/utils/result.js').Result<T>} Result */
/** @typedef {import('../../../libs/contracts/index.js').SkillMeta} SkillMeta */

export class SkillRegistry {
  constructor() {
    /** @type {Map<string, SkillMeta>} */
    this.map = new Map();
  }

  /**
   * @param {ReadonlyArray<SkillMeta>} items
   * @returns {Result<{ accepted: number, rejected: string[] }>}
   */
  loadAll(items) {
    if (!Array.isArray(items)) return err(ERROR_CODE.VALIDATION, 'skills 必须是数组');
    const rejected = [];
    const next = new Map();
    for (const s of items) {
      if (!s?.id || typeof s.id !== 'string') {
        rejected.push('<no-id>');
        continue;
      }
      if (next.has(s.id) || this.map.has(s.id)) rejected.push(s.id);
      next.set(s.id, Object.freeze({ ...s }));
    }
    // 重复 ID 直接拒绝（不覆盖先注册的），避免"后写的 yaml 悄悄顶掉前者"
    this.map = new Map([...this.map, ...[...next].filter(([id]) => !this.map.has(id))]);
    return ok({ accepted: next.size - rejected.filter((r) => r !== '<no-id>').length, rejected });
  }

  /**
   * @param {string} skillId
   * @returns {Result<SkillMeta>}
   */
  get(skillId) {
    const s = this.map.get(skillId);
    if (!s) return err(ERROR_CODE.VALIDATION, `未知 SKILL: ${skillId}`);
    return ok(s);
  }

  /**
   * @param {string} role
   * @returns {ReadonlyArray<SkillMeta>}
   */
  listByRole(role) {
    return Object.freeze([...this.map.values()].filter((s) => s.role === role));
  }

  /** @returns {ReadonlyArray<SkillMeta>} */
  list() {
    return Object.freeze([...this.map.values()]);
  }

  /** @param {string} skillId @param {string} siteId */
  allowsSite(skillId, siteId) {
    const s = this.map.get(skillId);
    if (!s) return false;
    return s.sites.length === 0 || s.sites.includes(siteId);
  }
}
