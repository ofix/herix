/**
 * AuditLogger：审计落盘。所有记录先脱敏再写 journal/audit-*.jsonl。
 * 审计只追加、不可删除，是"谁在什么时候批准了什么"的唯一证据链。
 * @module main/infra/observability/audit
 */
import { ok } from '../../../libs/utils/result.js';
import { redact } from '../security/redaction.js';

/** @template T @typedef {import('../../../libs/utils/result.js').Result<T>} Result */

/**
 * @typedef {object} AuditEntry
 * @property {string} action   如 'task.apply' | 'command.approve' | 'config.rejected'
 * @property {string} traceId
 * @property {'user'|'engine'|'worker'|'checker'|'system'} actor
 * @property {string} [target] 目标 ID（taskId/siteId/ticketId）
 * @property {object} [detail]
 * @property {'info'|'warn'|'error'} [level]
 */

export class AuditLogger {
  /**
   * @param {import('../storage/journal.js').Journal} journal
   */
  constructor(journal) {
    this.journal = journal;
  }

  /**
   * @param {AuditEntry} entry
   * @returns {Promise<Result<{ rel: string }>>}
   */
  async record(entry) {
    const safe = {
      ...entry,
      level: entry.level ?? 'info',
      detail: entry.detail ? redact(entry.detail) : undefined,
    };
    return this.journal.append('audit', safe);
  }

  /**
   * 便捷方法：命令相关审计必须带 ticketId 与批准人。
   * @param {object} args
   * @param {string} args.traceId
   * @param {string} args.ticketId
   * @param {string} args.approver
   * @param {string} args.commandHash
   * @param {'issued'|'consumed'|'denied'} args.phase
   * @returns {Promise<Result<{ rel: string }>>}
   */
  command({ traceId, ticketId, approver, commandHash, phase }) {
    return this.record({
      action: `command.${phase}`,
      traceId,
      actor: 'user',
      target: ticketId,
      detail: { approver, commandHash },
      level: phase === 'denied' ? 'warn' : 'info',
    });
  }
}

/**
 * 无 journal 时的空实现（用于单测与 UI 预览），保证调用点不需要判断 null。
 */
export const noopAudit = Object.freeze({
  record: async () => ok({ rel: '' }),
  command: async () => ok({ rel: '' }),
});
