/**
 * ProjectManager：Git 项目的打开/关闭与工作区隔离。
 * 设计：用户原始仓库只读，改动落在 `userData/herix/worktrees/<projectId>` 的 git worktree 里。
 * 这样 ① 模型改错也污染不到用户仓库 ② 回滚只需删目录 ③ 单机单用户无需远端。
 * @module main/git/project-manager
 */
import { ok, err } from '../../libs/utils/result.js';
import { ERROR_CODE } from '../../libs/utils/errors.js';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * @typedef {{ repoPath: string, worktreePath: string, baseRef: string, baseCommit: string }} ProjectRec
 */

export class ProjectManager {
  /**
   * @param {{ root: string, maxProjects?: number, git?: (args:string[], cwd:string)=>{ok:boolean,out:string,err?:string}, clock?: ()=>number }} deps
   */
  constructor(deps) {
    this.root = deps.root;
    this.maxProjects = deps.maxProjects ?? 8;
    this.git = deps.git ?? runGit;
    this.clock = deps.clock ?? Date.now;
    /** @type {Map<string, ProjectRec>} */
    this.projects = new Map();
  }

  /**
   * @param {{ projectId: string, repoPath: string, baseRef?: string }} args
   */
  open({ projectId, repoPath, baseRef = 'HEAD' }) {
    if (this.projects.has(projectId)) {
      return err(ERROR_CODE.PROJECT_LIMIT, `项目 ${projectId} 已打开`);
    }
    if (this.projects.size >= this.maxProjects) {
      return err(ERROR_CODE.PROJECT_LIMIT, `同时打开项目数上限 ${this.maxProjects}`);
    }
    const worktreePath = path.join(this.root, String(projectId).replace(/[^a-zA-Z0-9_.-]/g, '_'));
    if (!isInside(this.root, worktreePath)) {
      return err(ERROR_CODE.PROJECT_CLOSED, '工作区路径非法（越界）');
    }
    const head = this.git(['rev-parse', baseRef], repoPath);
    if (!head.ok) return err(ERROR_CODE.PROJECT_CLOSED, `无法解析基准版本 ${baseRef}`, { detail: head.err });
    const baseCommit = head.out.trim();

    const add = this.git(['worktree', 'add', '--detach', worktreePath, baseCommit], repoPath);
    if (!add.ok) return err(ERROR_CODE.PROJECT_CLOSED, '创建 worktree 失败', { detail: add.err });

    const rec = { repoPath, worktreePath, baseRef, baseCommit };
    this.projects.set(projectId, rec);
    return ok({ projectId, ...rec });
  }

  /** @param {string} projectId */
  get(projectId) {
    const rec = this.projects.get(projectId);
    return rec ? ok(rec) : err(ERROR_CODE.PROJECT_CLOSED, `项目 ${projectId} 未打开`);
  }

  /**
   * 关闭项目：默认移除 worktree（未合并的改动会丢失，因此先把 changeset 落盘再去）。
   * @param {string} projectId @param {{ removeWorktree?: boolean }} [opts]
   */
  close(projectId, opts = {}) {
    const rec = this.projects.get(projectId);
    if (!rec) return err(ERROR_CODE.PROJECT_CLOSED, `项目 ${projectId} 未打开`);
    if (opts.removeWorktree !== false) {
      const r = this.git(['worktree', 'remove', '--force', rec.worktreePath], rec.repoPath);
      if (!r.ok) return err(ERROR_CODE.PROJECT_CLOSED, '移除 worktree 失败', { detail: r.err });
    }
    this.projects.delete(projectId);
    return ok({ projectId, closedAt: new Date(this.clock()).toISOString() });
  }

  /** @returns {{ projectId: string, worktreePath: string, baseCommit: string }[]} */
  list() {
    return [...this.projects.entries()].map(([projectId, r]) => ({
      projectId,
      worktreePath: r.worktreePath,
      baseCommit: r.baseCommit,
    }));
  }

  /** 工作区内执行 git（不落到用户仓库） @param {string[]} args @param {string} projectId */
  exec(projectId, args) {
    const rec = this.projects.get(projectId);
    if (!rec) return err(ERROR_CODE.PROJECT_CLOSED, `项目 ${projectId} 未打开`);
    const r = this.git(args, rec.worktreePath);
    return r.ok ? ok(r.out.trim()) : err(ERROR_CODE.STORE_IO, 'git 执行失败', { detail: r.err });
  }
}

/**
 * @param {string[]} args @param {string} cwd
 * @returns {{ ok: boolean, out: string, err?: string }}
 */
export function runGit(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30000 });
  if (r.error) return { ok: false, out: '', err: r.error.message };
  if (r.status !== 0) return { ok: false, out: r.stdout ?? '', err: r.stderr ?? `exit ${r.status}` };
  return { ok: true, out: r.stdout ?? '' };
}

/**
 * @param {string} parent @param {string} child
 */
export function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
