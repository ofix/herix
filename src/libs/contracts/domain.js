/**
 * 领域枚举（唯一真源）。代码中禁止直接写字符串字面量，只能引用本文件常量。
 * 值 + 类型同名不同形态：常量大写下划线，类型用驼峰 typedef。
 * @module libs/contracts/domain
 */

/**
 * 任务状态。
 * @typedef {'queued'|'running'|'awaiting_human'|'done'|'failed_retryable'|'failed_final'|'cancelled'} TaskState
 */
export const TASK_STATE = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  AWAITING_HUMAN: 'awaiting_human',
  DONE: 'done',
  FAILED_RETRYABLE: 'failed_retryable',
  FAILED_FINAL: 'failed_final',
  CANCELLED: 'cancelled',
});

/** 已终止的任务状态集合（状态机 isTerminal 的唯一依据）。 */
export const TASK_TERMINAL = Object.freeze(['done', 'failed_final', 'cancelled']);

/**
 * 站点状态。
 * @typedef {'available'|'busy'|'unavailable'|'logged_out'|'cooling'} SiteState
 */
export const SITE_STATE = Object.freeze({
  AVAILABLE: 'available',
  BUSY: 'busy',
  UNAVAILABLE: 'unavailable',
  LOGGED_OUT: 'logged_out',
  COOLING: 'cooling',
});

/**
 * 会议状态。
 * @typedef {'open'|'round1'|'round2'|'voting'|'concluded'|'reopened'|'aborted'} ConferenceState
 */
export const CONFERENCE_STATE = Object.freeze({
  OPEN: 'open',
  ROUND1: 'round1',
  ROUND2: 'round2',
  VOTING: 'voting',
  CONCLUDED: 'concluded',
  REOPENED: 'reopened',
  ABORTED: 'aborted',
});

/**
 * 模型输出风险评估结果。
 * @typedef {'safe'|'suspicious'|'blocked'} RiskState
 */
export const RISK_STATE = Object.freeze({ SAFE: 'safe', SUSPICIOUS: 'suspicious', BLOCKED: 'blocked' });

/**
 * 会议投票。
 * @typedef {'approve'|'reject'|'abstain'} Vote
 */
export const VOTE = Object.freeze({ APPROVE: 'approve', REJECT: 'reject', ABSTAIN: 'abstain' });

/** 项目状态：可并行，关闭后不再接任务。 */
/** @typedef {'open'|'closing'|'closed'} ProjectState */
export const PROJECT_STATE = Object.freeze({ OPEN: 'open', CLOSING: 'closing', CLOSED: 'closed' });
