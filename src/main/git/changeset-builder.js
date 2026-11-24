/**
 * ChangesetBuilder：把一次改动固化成可审计、可回滚的 changeset 目录。
 * 结构（userData/herix/changesets/<id>/）：
 *   manifest.json  元信息（任务、站点、基底 commit、文件、审查结论）
 *   patch.diff     原始 diff（回滚与复核的唯一真源）
 *   result.json    应用后的 git diff --stat / 新增文件列表
 * @module main/git/changeset-builder
 */
import path from 'node:path';
import { ok, err } from '../../libs/utils/result.js';
import { ERROR_CODE } from '../../libs/utils/errors.js';

export class ChangesetBuilder {
  /**
   * @param {{ root: string, store: any, clock?: ()=>number, idGen?: ()=>string }} deps
   * store 需实现 writeTextAtomic(relPath, text) / readText(relPath)
   */
  constructor(deps) {
    this.root = deps.root;
    this.store = deps.store;
    this.clock = deps.clock ?? Date.now;
    this.idGen = deps.idGen ?? (() => `chs_${Math.random().toString(16).slice(2, 10)}`);
  }

  /**
   * @param {{ projectId: string, taskId: string, siteId?: string, baseCommit: string, diff: string, files: string[], meta?: any }} input
   */
  async build(input) {
    if (!input?.diff) return err(ERROR_CODE.PATCH_PARSE, 'changeset 缺少 diff');
    const id = this.idGen();
    const dir = path.join(this.root, id);
    const manifest = {
      id,
      projectId: input.projectId,
      taskId: input.taskId,
      siteId: input.siteId ?? null,
      baseCommit: input.baseCommit,
      files: input.files ?? [],
      createdAt: new Date(this.clock()).toISOString(),
      status: 'pending',
      meta: input.meta ?? {},
    };

    const w1 = await this.store.writeTextAtomic(path.join(dir, 'patch.diff'), input.diff);
    if (!w1.ok) return err(ERROR_CODE.STORE_IO, '写入 patch.diff 失败', { detail: w1.error });
    const w2 = await this.store.writeTextAtomic(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    if (!w2.ok) return err(ERROR_CODE.STORE_IO, '写入 manifest.json 失败', { detail: w2.error });

    return ok({ id, dir, manifest });
  }

  /**
   * 应用结果回写（apply 成功后调用；人工否决时 status=rejected）。
   * @param {{ id: string, status: 'applied'|'rejected'|'pending', result?: any }} args
   */
  async finalize({ id, status, result }) {
    const dir = path.join(this.root, id);
    const m = await this.store.readText(path.join(dir, 'manifest.json'));
    if (!m.ok || m.value === null) return err(ERROR_CODE.STORE_IO, `changeset ${id} 不存在`);
    let manifest;
    try {
      manifest = JSON.parse(m.value);
    } catch {
      return err(ERROR_CODE.STORE_IO, `manifest 损坏：${id}`);
    }
    manifest.status = status;
    manifest.finalizedAt = new Date(this.clock()).toISOString();
    const w = await this.store.writeTextAtomic(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    if (!w.ok) return w;
    if (result) await this.store.writeTextAtomic(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
    return ok({ id, status });
  }

  /** @param {string} id */
  async read(id) {
    const dir = path.join(this.root, id);
    const m = await this.store.readText(path.join(dir, 'manifest.json'));
    const d = await this.store.readText(path.join(dir, 'patch.diff'));
    if (!m.ok || m.value === null || !d.ok || d.value === null) {
      return err(ERROR_CODE.STORE_IO, `changeset ${id} 读取失败`);
    }
    try {
      return ok({ manifest: JSON.parse(m.value), diff: d.value });
    } catch {
      return err(ERROR_CODE.STORE_IO, `manifest 损坏：${id}`);
    }
  }
}
