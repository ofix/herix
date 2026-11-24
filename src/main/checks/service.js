/**
 * CheckService：检查编排。一轮检查 = 挑 provider → 逐条签票 → 跑命令 → 解析 → 汇总。
 * 关键策略：
 * ① 一个 provider 一条票据（approvalScope='single'；同批同 provider 才可 batch）
 * ② 工具缺失（E_TOOL_MISSING / exit 127）不算失败，产 info 诊断，不阻断主流程
 * ③ 结果按 severity 排序，error 优先；只有 error 会让 checkResult.pass=false
 * @module main/checks/service
 */

import { ok, err } from '../../libs/utils/result.js';
import { ERROR_CODE } from '../../libs/utils/errors.js';
import { diag } from './providers/_shared.js';

export class CheckService {
  /**
   * @param {{ registry: any, policy: any, runner: any, clock?: ()=>number, log?: (m:string)=>void }} deps
   */
  constructor(deps) {
    this.registry = deps.registry;
    this.policy = deps.policy;
    this.runner = deps.runner;
    this.clock = deps.clock ?? Date.now;
    this.log = deps.log ?? (() => {});
  }

  /**
   * @param {{ files: string[], worktreePath: string, worktreeHash: string, providerIds?: string[] }} req
   * @returns {Promise<import('../../libs/utils/result.js').Result<{pass:boolean, diagnostics:any[], ran:string[], skipped:any[], elapsedMs:number}>>}
   */
  async run(req) {
    const t0 = this.clock();
    const picked = req.providerIds?.length
      ? req.providerIds.map((id) => this.registry.get(id)).filter((r) => r.ok).map((r) => r.value)
      : this.registry.detect(req.files).providers;
    if (picked.length === 0) {
      return ok({ pass: true, diagnostics: [], ran: [], skipped: [], elapsedMs: 0 });
    }

    /** @type {any[]} */
    const diagnostics = [];
    const ran = [];
    const skipped = [];

    for (const p of picked) {
      const spec = typeof p.buildCommand === 'function' ? p.buildCommand({ files: req.files }) : p.command;
      if (!spec?.cmd) {
        skipped.push({ id: p.id, reason: '无法构造命令' });
        continue;
      }
      const issued = this.policy.issue({
        cmd: spec.cmd,
        args: spec.args ?? [],
        cwd: req.worktreePath,
        worktreeHash: req.worktreeHash,
        approver: 'check-service',
        scope: 'single',
        providerId: p.id,
      });
      if (!issued.ok) {
        skipped.push({ id: p.id, reason: issued.error.message });
        continue;
      }

      const res = await this.runner.run({
        ticketId: issued.value.id,
        cmd: spec.cmd,
        args: spec.args ?? [],
        cwd: req.worktreePath,
        worktreePath: req.worktreePath,
        worktreeHash: req.worktreeHash,
      });

      if (!res.ok) {
        diagnostics.push(
          diag({
            provider: p.id,
            language: p.language,
            severity: 'info',
            code: 'tool-missing',
            message: `检查器不可用：${res.error.message}`,
          }),
        );
        skipped.push({ id: p.id, reason: res.error.message });
        continue;
      }
      ran.push(p.id);
      if (res.value.code === 127 || res.value.timedOut) {
        diagnostics.push(
          diag({
            provider: p.id,
            language: p.language,
            severity: 'info',
            code: res.value.timedOut ? 'timeout' : 'tool-missing',
            message: res.value.timedOut ? '检查器超时，结果不完整' : '命令不存在（127）',
          }),
        );
      }
      const out = { stdout: res.value.stdout, stderr: res.value.stderr };
      diagnostics.push(...(p.parse(out) ?? []));
      this.log(`[check] ${p.id} exit=${res.value.code} diag=${diagnostics.length}`);
    }

    diagnostics.sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
    const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
    return ok({
      pass: errorCount === 0,
      diagnostics,
      ran,
      skipped,
      errorCount,
      elapsedMs: this.clock() - t0,
    });
  }

  /**
   * 把诊断压成给模型看的回灌文本（只带 error/warning，限条数，防吃掉上下文）。
   * @param {any[]} diagnostics @param {{ max?: number }} [opts]
   */
  static toFeedback(diagnostics, opts = {}) {
    const max = opts.max ?? 30;
    const list = (diagnostics ?? []).filter((d) => d.severity !== 'info').slice(0, max);
    if (list.length === 0) return err(ERROR_CODE.VALIDATION, '没有需要回灌的诊断');
    const lines = list.map((d) => {
      const loc = d.file ? `${d.file}${d.line ? `:${d.line}${d.col ? `:${d.col}` : ''}` : ''}` : '<global>';
      return `- [${d.severity}] ${loc} ${d.code}: ${d.message}`;
    });
    return ok(
      [
        `静态检查发现 ${list.length} 处问题，请只修这些，不要重构无关代码：`,
        ...lines,
      ].join('\n'),
    );
  }
}

/** @param {string} s */
function sevRank(s) {
  return s === 'error' ? 0 : s === 'warning' ? 1 : 2;
}
