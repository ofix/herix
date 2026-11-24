/**
 * CommandPolicy：强制逐次授权闸。
 * 每条命令都要一张一次性票据，票据由人（approver）签发，绑死 `cmd+args+cwd+worktreeHash` 的摘要，
 * 默认 5 分钟失效，用一次即废。任何一项对不上就拒绝 —— 这是防"批了 A 却跑了 B"的唯一手段。
 * 取消只读命令免审批通道（v0.7 决策）：一律审批，避免"读命令"成为绕过路径。
 * @module main/sandbox/command-policy
 */
import { createHash, randomUUID } from 'node:crypto';
import { ok, err } from '../../libs/utils/result.js';
import { ERROR_CODE } from '../../libs/utils/errors.js';

/**
 * @typedef {{ cmd: string, argsPrefix?: string[], label?: string }} AllowRule
 * @typedef {{ id: string, digest: string, scope: 'single'|'batch', approver: string, expiresAt: number, usedAt?: number, providerId?: string }} Ticket
 */

export class CommandPolicy {
  /**
   * @param {{ allowlist?: AllowRule[], ttlMs?: number, clock?: ()=>number, maxTickets?: number }} deps
   */
  constructor(deps) {
    this.allowlist = deps.allowlist ?? defaultAllowlist();
    this.ttlMs = deps.ttlMs ?? 5 * 60 * 1000;
    this.clock = deps.clock ?? Date.now;
    this.maxTickets = deps.maxTickets ?? 64;
    /** @type {Map<string, Ticket>} */
    this.tickets = new Map();
    /** @type {{ at: string, action: string, cmd: string, approver?: string, reason?: string }[]} */
    this.audit = [];
  }

  /** 白名单判定（精确到 args 前缀，杜绝 `npm run evil`） @param {string} cmd @param {string[]} args */
  allowed(cmd, args = []) {
    return this.allowlist.some((r) => {
      if (r.cmd !== cmd) return false;
      const p = r.argsPrefix ?? [];
      return p.every((x, i) => args[i] === x);
    });
  }

  /**
   * 人批准后签票。
   * @param {{ cmd: string, args: string[], cwd: string, worktreeHash: string, approver: string, scope?: 'single'|'batch', providerId?: string }} args
   */
  issue({ cmd, args, cwd, worktreeHash, approver, scope = 'single', providerId }) {
    if (!this.allowed(cmd, args)) {
      return err(ERROR_CODE.COMMAND_DENIED, `命令不在白名单：${cmd} ${args.join(' ')}`);
    }
    if (!approver) return err(ERROR_CODE.COMMAND_UNAUTHORIZED, '缺少审批人');
    this._gc();
    if (this.tickets.size >= this.maxTickets) {
      return err(ERROR_CODE.COMMAND_DENIED, '未使用票据过多，请先处理待批准请求');
    }
    const now = this.clock();
    const ticket = {
      id: `cmd_${randomUUID().slice(0, 8)}`,
      digest: digestOf(cmd, args, cwd, worktreeHash),
      scope,
      approver,
      expiresAt: now + this.ttlMs,
      providerId,
    };
    this.tickets.set(ticket.id, ticket);
    this._log('issue', cmd, approver);
    return ok(ticket);
  }

  /**
   * 执行前核验。
   * @param {{ ticketId: string, cmd: string, args: string[], cwd: string, worktreeHash: string }} args
   */
  authorize({ ticketId, cmd, args, cwd, worktreeHash }) {
    const t = this.tickets.get(ticketId);
    if (!t) return err(ERROR_CODE.COMMAND_UNAUTHORIZED, '票据不存在（已用过或未签发）');
    if (this.clock() > t.expiresAt) {
      this.tickets.delete(ticketId);
      this._log('expired', cmd, t.approver);
      return err(ERROR_CODE.COMMAND_UNAUTHORIZED, '票据已过期');
    }
    if (t.digest !== digestOf(cmd, args, cwd, worktreeHash)) {
      this._log('mismatch', cmd, t.approver, '票据绑定的命令/目录/工作区不一致');
      return err(ERROR_CODE.COMMAND_UNAUTHORIZED, '票据与实际命令不匹配（可能被替换）');
    }
    if (!this.allowed(cmd, args)) {
      this._log('denied', cmd, t.approver, '命令不在白名单');
      return err(ERROR_CODE.COMMAND_DENIED, '命令不在白名单');
    }
    if (t.scope === 'single') this.tickets.delete(ticketId);
    else t.usedAt = this.clock();
    this._log('authorize', cmd, t.approver);
    return ok({ ticketId, scope: t.scope, approver: t.approver });
  }

  /** @param {string} ticketId */
  revoke(ticketId) {
    const had = this.tickets.delete(ticketId);
    return ok({ revoked: had });
  }

  /** 待批准/已签发快照，用于 UI 排队展示 */
  pending() {
    return [...this.tickets.values()].map((t) => ({
      id: t.id,
      scope: t.scope,
      approver: t.approver,
      expiresAt: new Date(t.expiresAt).toISOString(),
    }));
  }

  /** 清理过期票据 @private */
  _gc() {
    const now = this.clock();
    for (const [id, t] of this.tickets) if (now > t.expiresAt) this.tickets.delete(id);
  }

  /** @param {string} action @param {string} cmd @param {string} [approver] @param {string} [reason] @private */
  _log(action, cmd, approver, reason) {
    this.audit.push({ at: new Date(this.clock()).toISOString(), action, cmd, approver, reason });
    if (this.audit.length > 500) this.audit.shift();
  }
}

/**
 * @param {string} cmd @param {string[]} args @param {string} cwd @param {string} worktreeHash
 */
export function digestOf(cmd, args, cwd, worktreeHash) {
  return createHash('sha256')
    .update([cmd, ...(args ?? []), cwd, worktreeHash].join('\u0000'))
    .digest('hex')
    .slice(0, 32);
}

/** 初始白名单：只放检查器与测试入口，不含任何能起 shell 的工具 */
export function defaultAllowlist() {
  return [
    { cmd: 'npx', argsPrefix: ['tsc'], label: 'tsc 类型检查' },
    { cmd: 'npx', argsPrefix: ['eslint'], label: 'eslint 规范检查' },
    { cmd: 'npx', argsPrefix: ['vitest'], label: '单测' },
    { cmd: 'git', argsPrefix: ['status'], label: 'git status' },
    { cmd: 'git', argsPrefix: ['diff'], label: 'git diff' },
    { cmd: 'ruff', argsPrefix: ['check'], label: 'ruff' },
    { cmd: 'pyright', argsPrefix: [], label: 'pyright' },
    { cmd: 'go', argsPrefix: ['vet'], label: 'go vet' },
    { cmd: 'staticcheck', argsPrefix: [], label: 'staticcheck' },
    { cmd: 'cargo', argsPrefix: ['clippy'], label: 'cargo clippy' },
    { cmd: 'clang-tidy', argsPrefix: [], label: 'clang-tidy' },
  ];
}
