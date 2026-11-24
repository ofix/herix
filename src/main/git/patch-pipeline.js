/**
 * PatchPipeline：模型 diff → 校验 → 落地。这是整个系统最危险的一步，因此四道闸：
 * ① 语法闸：必须是 unified diff，且能解析出路径
 * ② 路径闸：拒绝绝对路径、`..`、以及工作区外的符号链接目标
 * ③ 大小闸：单 patch 行数/字节数上限
 * ④ 干跑闸：`git apply --check` 必须通过才真 apply（防 TOCTOU 半截写入）
 * @module main/git/patch-pipeline
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ok, err } from '../../libs/utils/result.js';
import { ERROR_CODE } from '../../libs/utils/errors.js';
import { isInside } from './project-manager.js';

const DEFAULT_LIMIT = { bytes: 512 * 1024, files: 40 };

export class PatchPipeline {
  /**
   * @param {{ git?: (args:string[], cwd:string, input?:string)=>{ok:boolean,out:string,err?:string}, limit?: Partial<typeof DEFAULT_LIMIT> }} deps
   */
  constructor(deps) {
    this.git = deps.git ?? runGitWithStdin;
    this.limit = { ...DEFAULT_LIMIT, ...(deps.limit ?? {}) };
  }

  /**
   * 从 diff 文本提取被修改文件路径（新路径）。
   * @param {string} diff
   * @returns {string[]}
   */
  static parsePaths(diff) {
    const out = [];
    const lines = String(diff ?? '').split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith('+++ ')) {
        const p = line.slice(4).trim().replace(/^b\//, '').replace(/\t.*$/, '');
        if (p && p !== '/dev/null') out.push(p);
      }
    }
    return [...new Set(out)];
  }

  /**
   * @param {{ worktreePath: string, diff: string }} args
   */
  validate({ worktreePath, diff }) {
    const text = String(diff ?? '');
    if (!/^---\s+\S/m.test(text) || !/^\+\+\+\s+\S/m.test(text)) {
      return err(ERROR_CODE.PATCH_PARSE, '不是 unified diff（缺 ---/+++ 头）');
    }
    if (Buffer.byteLength(text, 'utf8') > this.limit.bytes) {
      return err(ERROR_CODE.PATCH_PARSE, `patch 超过 ${this.limit.bytes} 字节上限`);
    }
    const files = PatchPipeline.parsePaths(text);
    if (files.length === 0) return err(ERROR_CODE.PATCH_PARSE, 'diff 未指向任何文件');
    if (files.length > this.limit.files) {
      return err(ERROR_CODE.PATCH_PARSE, `单次改动文件数 ${files.length} 超过 ${this.limit.files}`);
    }
    for (const rel of files) {
      if (path.isAbsolute(rel) || rel.split('/').includes('..') || rel.includes('\\..')) {
        return err(ERROR_CODE.PATCH_CONFLICT, `路径越界：${rel}`);
      }
      const abs = path.join(worktreePath, rel);
      if (!isInside(worktreePath, abs) && abs !== worktreePath) {
        return err(ERROR_CODE.PATCH_CONFLICT, `路径越界：${rel}`);
      }
    }
    const check = this.git(['apply', '--check', '--whitespace=nowarn', '-'], worktreePath, text);
    if (!check.ok) {
      return err(ERROR_CODE.PATCH_CONFLICT, 'git apply --check 失败（上下文不匹配或已冲突）', { detail: check.err });
    }
    return ok({ files, bytes: Buffer.byteLength(text, 'utf8') });
  }

  /**
   * 干跑通过后真落地。
   * @param {{ worktreePath: string, diff: string, taskId?: string }} args
   */
  apply({ worktreePath, diff }) {
    const v = this.validate({ worktreePath, diff });
    if (!v.ok) return v;
    const r = this.git(['apply', '--whitespace=nowarn', '-'], worktreePath, diff);
    if (!r.ok) return err(ERROR_CODE.PATCH_CONFLICT, 'git apply 失败', { detail: r.err });
    const stat = this.git(['diff', '--stat'], worktreePath);
    return ok({ files: v.value.files, stat: stat.ok ? stat.out.trim() : '' });
  }

  /**
   * 反向 apply（回滚某次改动），同样先干跑。
   * @param {{ worktreePath: string, diff: string }} args
   */
  revert({ worktreePath, diff }) {
    const check = this.git(['apply', '--reverse', '--check', '-'], worktreePath, diff);
    if (!check.ok) return err(ERROR_CODE.PATCH_CONFLICT, '回滚干跑失败：patch 与当前工作区不符', { detail: check.err });
    const r = this.git(['apply', '--reverse', '-'], worktreePath, diff);
    if (!r.ok) return err(ERROR_CODE.PATCH_CONFLICT, '回滚失败', { detail: r.err });
    return ok({ reverted: true });
  }
}

/**
 * 需要从 stdin 灌 diff 的 git 调用（git apply - 只能走 stdin）。
 * @param {string[]} args @param {string} cwd @param {string} [input]
 * @returns {{ ok: boolean, out: string, err?: string }}
 */
export function runGitWithStdin(args, cwd, input = '') {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', input, timeout: 30000 });
  if (r.error) return { ok: false, out: '', err: r.error.message };
  if (r.status !== 0) return { ok: false, out: r.stdout ?? '', err: (r.stderr ?? '').slice(0, 400) || `exit ${r.status}` };
  return { ok: true, out: r.stdout ?? '' };
}
