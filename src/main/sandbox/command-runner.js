/**
 * CommandRunner：票据核验 + 无 shell 执行。
 * 要点：① `shell:false` + 参数数组，天然免疫注入 ② cwd 必须落在工作区内 ③ 硬超时 ④ 输出截断
 * ⑤ 退出码非 0 不算异常，作为结果返回（检查器输出本身就是"失败=有问题"）。
 * @module main/sandbox/command-runner
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ok, err } from '../../libs/utils/result.js';
import { ERROR_CODE } from '../../libs/utils/errors.js';

const DEFAULTS = { timeoutMs: 120000, maxOutputBytes: 256 * 1024 };

export class CommandRunner {
  /**
   * @param {{ policy: any, clock?: ()=>number, spawnImpl?: Function, limit?: Partial<typeof DEFAULTS> }} deps
   */
  constructor(deps) {
    this.policy = deps.policy;
    this.clock = deps.clock ?? Date.now;
    this.spawnImpl = deps.spawnImpl ?? spawn;
    this.limit = { ...DEFAULTS, ...(deps.limit ?? {}) };
  }

  /**
   * @param {{ ticketId: string, cmd: string, args: string[], cwd: string, worktreePath: string, worktreeHash: string }} req
   */
  async run(req) {
    const cwd = path.resolve(req.cwd);
    const root = path.resolve(req.worktreePath);
    const rel = path.relative(root, cwd);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return err(ERROR_CODE.COMMAND_DENIED, '命令目录不在工作区内');
    }
    const auth = this.policy.authorize({
      ticketId: req.ticketId,
      cmd: req.cmd,
      args: req.args,
      cwd: req.cwd,
      worktreeHash: req.worktreeHash,
    });
    if (!auth.ok) return auth;

    const started = this.clock();
    return new Promise((resolve) => {
      /** @type {{ code:number|null, signal:string|null, stdout:string, stderr:string, timedOut:boolean, truncated:boolean }} */
      const acc = { code: null, signal: null, stdout: '', stderr: '', timedOut: false, truncated: false };
      /** @type {any} */
      let child;
      try {
        child = this.spawnImpl(req.cmd, req.args, {
          cwd,
          shell: false,
          env: { ...process.env, NO_COLOR: '1', CI: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (e) {
        return resolve(err(ERROR_CODE.TOOL_MISSING, `无法启动 ${req.cmd}`, { detail: /** @type {Error} */ (e).message }));
      }

      const timer = setTimeout(() => {
        acc.timedOut = true;
        child.kill('SIGKILL');
      }, this.limit.timeoutMs);
      if (timer.unref) timer.unref();

      const collect = (chunk, key) => {
        acc[key] += chunk.toString();
        const cap = this.limit.maxOutputBytes;
        if (acc[key].length > cap) {
          acc[key] = acc[key].slice(0, cap);
          acc.truncated = true;
          child.kill('SIGKILL');
        }
      };
      child.stdout?.on('data', (c) => collect(c, 'stdout'));
      child.stderr?.on('data', (c) => collect(c, 'stderr'));

      child.on('error', (e) => {
        clearTimeout(timer);
        resolve(err(ERROR_CODE.TOOL_MISSING, `执行 ${req.cmd} 出错：${e.message}`));
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        acc.code = code;
        acc.signal = signal;
        resolve(
          ok({
            cmd: req.cmd,
            args: req.args,
            code,
            stdout: acc.stdout,
            stderr: acc.stderr,
            timedOut: acc.timedOut,
            truncated: acc.truncated,
            elapsedMs: this.clock() - started,
          }),
        );
      });
    });
  }
}
