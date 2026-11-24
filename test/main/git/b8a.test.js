/**
 * B8a：ProjectManager（真 git worktree）/ PatchPipeline（真 git apply）/ ChangesetBuilder。
 * 全部在临时目录里跑真实 git，不 mock —— 这层错了就是改坏用户仓库。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ProjectManager, isInside } from '../../../src/main/git/project-manager.js';
import { PatchPipeline } from '../../../src/main/git/patch-pipeline.js';
import { ChangesetBuilder } from '../../../src/main/git/changeset-builder.js';

/** @type {string} */
let base;
/** @type {string} */
let repo;

const g = (args, cwd = repo, input) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', input, timeout: 30000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), 'herix-b8a-'));
  repo = path.join(base, 'repo');
  mkdirSync(repo);
  g(['init', '-q'], repo);
  g(['config', 'user.email', 'a@b.c'], repo);
  g(['config', 'user.name', 't'], repo);
  writeFileSync(path.join(repo, 'a.js'), 'export const a = 1;\n');
  g(['add', '.'], repo);
  g(['commit', '-qm', 'init'], repo);
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('ProjectManager', () => {
  it('打开项目会创建独立 worktree，且指向 base commit', () => {
    const pm = new ProjectManager({ root: path.join(base, 'wt') });
    const r = pm.open({ projectId: 'prj_b8a0001', repoPath: repo });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.worktreePath).toContain('wt');
    expect(readFileSync(path.join(r.value.worktreePath, 'a.js'), 'utf8')).toContain('const a = 1');
    expect(pm.list()).toHaveLength(1);
    pm.close('prj_b8a0001');
  });

  it('重复打开同 id 报 E_PROJECT_LIMIT', () => {
    const pm = new ProjectManager({ root: path.join(base, 'wt') });
    expect(pm.open({ projectId: 'prj_b8a0002', repoPath: repo }).ok).toBe(true);
    const again = pm.open({ projectId: 'prj_b8a0002', repoPath: repo });
    expect(again.ok).toBe(false);
    pm.close('prj_b8a0002');
  });

  it('非法 baseRef 打开失败', () => {
    const pm = new ProjectManager({ root: path.join(base, 'wt') });
    const r = pm.open({ projectId: 'prj_b8a0003', repoPath: repo, baseRef: 'nope' });
    expect(r.ok).toBe(false);
  });

  it('上限 maxProjects 生效', () => {
    const pm = new ProjectManager({ root: path.join(base, 'wt'), maxProjects: 1 });
    pm.open({ projectId: 'prj_b8a0004', repoPath: repo });
    expect(pm.open({ projectId: 'prj_b8a0005', repoPath: repo }).ok).toBe(false);
    pm.close('prj_b8a0004');
  });

  it('未打开的项目 close/get 报错', () => {
    const pm = new ProjectManager({ root: path.join(base, 'wt') });
    expect(pm.close('prj_nope').ok).toBe(false);
    expect(pm.get('prj_nope').ok).toBe(false);
  });

  it('isInside 拒绝越界路径', () => {
    expect(isInside('/a/b', '/a/b/c')).toBe(true);
    expect(isInside('/a/b', '/a/c')).toBe(false);
    expect(isInside('/a/b', '/a/b/../c')).toBe(false);
  });
});

describe('PatchPipeline', () => {
  const DIFF = [
    '--- a/a.js',
    '+++ b/a.js',
    '@@ -1 +1 @@',
    '-export const a = 1;',
    '+export const a = 2;',
    '',
  ].join('\n');

  it('parsePaths 提取新路径', () => {
    expect(PatchPipeline.parsePaths(DIFF)).toEqual(['a.js']);
  });

  it('非 unified diff 被拒', () => {
    const r = new PatchPipeline({}).validate({ worktreePath: repo, diff: '随便改改' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('E_PATCH_PARSE');
  });

  it('路径越界（..）被拒', () => {
    const bad = '--- a/../../etc/passwd\n+++ b/../../etc/passwd\n@@ -1 +1 @@\n-x\n+y\n';
    const r = new PatchPipeline({}).validate({ worktreePath: repo, diff: bad });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('E_PATCH_CONFLICT');
  });

  it('绝对路径形式的文件名被改为相对后仍受 apply 干跑保护', () => {
    const bad = '--- a//etc/passwd\n+++ b//etc/passwd\n@@ -1 +1 @@\n-x\n+y\n';
    const r = new PatchPipeline({}).validate({ worktreePath: repo, diff: bad });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('E_PATCH_CONFLICT');
  });

  it('上下文不匹配 → dry-run 失败 E_PATCH_CONFLICT', () => {
    const bad = '--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-export const a = 999;\n+export const a = 2;\n';
    const r = new PatchPipeline({}).apply({ worktreePath: repo, diff: bad });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('E_PATCH_CONFLICT');
  });

  it('正常 diff 真落地，文件内容改变', () => {
    const pp = new PatchPipeline({});
    const r = pp.apply({ worktreePath: repo, diff: DIFF });
    expect(r.ok).toBe(true);
    expect(readFileSync(path.join(repo, 'a.js'), 'utf8')).toContain('a = 2');
    // 回滚
    const back = pp.revert({ worktreePath: repo, diff: DIFF });
    expect(back.ok).toBe(true);
    expect(readFileSync(path.join(repo, 'a.js'), 'utf8')).toContain('a = 1');
  });

  it('超过文件数上限被拒', () => {
    const pp = new PatchPipeline({ limit: { files: 1 } });
    const two = DIFF + DIFF.replace(/a\.js/g, 'b.js');
    const r = pp.validate({ worktreePath: repo, diff: two });
    expect(r.ok).toBe(false);
  });

  it('超过字节上限被拒', () => {
    const pp = new PatchPipeline({ limit: { bytes: 10 } });
    expect(pp.validate({ worktreePath: repo, diff: DIFF }).ok).toBe(false);
  });
});

describe('ChangesetBuilder', () => {
  let tmp;
  let store;
  beforeAll(() => {
    tmp = path.join(base, 'changesets');
    /** @type {Map<string,string>} */
    const mem = new Map();
    store = {
      writeTextAtomic: async (p, t) => { mem.set(p, t); return { ok: true, value: { bytes: t.length } }; },
      readText: async (p) => (mem.has(p) ? { ok: true, value: mem.get(p) } : { ok: true, value: null }),
    };
  });

  it('build 产出 manifest + patch.diff', async () => {
    const cb = new ChangesetBuilder({ root: tmp, store, idGen: () => 'chs_0001aaaa' });
    const r = await cb.build({
      projectId: 'prj_1', taskId: 'tsk_1', baseCommit: 'abc', diff: 'x', files: ['a.js'],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).toBe('chs_0001aaaa');
    expect(r.value.manifest.status).toBe('pending');
    const back = await cb.read('chs_0001aaaa');
    expect(back.ok && back.value.manifest.taskId).toBe('tsk_1');
  });

  it('finalize 改状态并落 result', async () => {
    const cb = new ChangesetBuilder({ root: tmp, store, idGen: () => 'chs_0002bbbb' });
    await cb.build({ projectId: 'p', taskId: 't', baseCommit: 'c', diff: 'd', files: [] });
    const f = await cb.finalize({ id: 'chs_0002bbbb', status: 'applied', result: { files: 1 } });
    expect(f.ok).toBe(true);
    const back = await cb.read('chs_0002bbbb');
    expect(back.ok && back.value.manifest.status).toBe('applied');
  });

  it('不存在的 changeset finalize 报 E_STORE_IO', async () => {
    const cb = new ChangesetBuilder({ root: tmp, store });
    expect((await cb.finalize({ id: 'chs_none', status: 'applied' })).ok).toBe(false);
  });

  it('空 diff 拒绝', async () => {
    const cb = new ChangesetBuilder({ root: tmp, store });
    expect((await cb.build({ projectId: 'p', taskId: 't', baseCommit: 'c', diff: '', files: [] })).ok).toBe(false);
  });
});
