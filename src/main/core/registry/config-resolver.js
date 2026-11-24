/**
 * ConfigResolver：资源解析的唯一入口。
 * 顺序：resources 默认 → userData 覆盖（整文件替换）→ zod 校验 → 失败回退默认并记审计。
 * 单个文件失败不影响其他文件；热加载失败不影响在跑任务。
 * @module main/core/registry/config-resolver
 */
import { ok, err } from '../../../libs/utils/result.js';
import { ERROR_CODE } from '../../../libs/utils/errors.js';

/** @template T @typedef {import('../../../libs/utils/result.js').Result<T>} Result */
/** @typedef {import('../../../libs/contracts/index.js').CallCtx} CallCtx */

/**
 * @typedef {object} ResolveDeps
 * @property {(rel:string)=>Promise<any>} readDefault 读 resources/ 下的原始文本
 * @property {(rel:string)=>Promise<any>} readOverride 读 userData 覆盖层的原始文本
 * @property {(rel:string)=>Promise<string[]>} listDefault
 * @property {(rel:string)=>Promise<string[]>} listOverride
 * @property {(kind:string, file:string, reason:string) => void} [onReject] 审计回调
 * @property {(text:string) => any} parseYaml
 * @property {(text:string) => any} [schemaOf] 按 kind 取 zod schema
 */

export class ConfigResolver {
  /** @param {ResolveDeps} deps */
  constructor(deps) {
    this.deps = deps;
    this.watchers = new Set();
  }

  /**
   * @param {'skills'|'sites'} kind
   * @param {CallCtx} ctx
   * @returns {Promise<Result<{ items: any[], sources: string[], rejected: string[] }>>}
   */
  async load(kind, ctx) {
    void ctx;
    if (!['skills', 'sites'].includes(kind)) {
      return err(ERROR_CODE.VALIDATION, `未知资源类型: ${kind}`);
    }
    const rejected = [];
    const items = [];
    const sources = [];

    const defaults = await this.deps.listDefault(kind).catch(() => []);
    const overrides = await this.deps.listOverride(kind).catch(() => []);
    const overrideSet = new Set(overrides);

    for (const file of [...new Set([...defaults, ...overrides])]) {
      const isOverride = overrideSet.has(file);
      const raw = isOverride ? await this.deps.readOverride(`${kind}/${file}`) : await this.deps.readDefault(`${kind}/${file}`);
      if (!raw?.ok || raw.value === null) {
        rejected.push(`${kind}/${file}`);
        this.deps.onReject?.(kind, file, 'read-failed');
        continue;
      }
      let parsed;
      try {
        parsed = this.deps.parseYaml(raw.value);
      } catch (e) {
        rejected.push(`${kind}/${file}`);
        this.deps.onReject?.(kind, file, `yaml: ${/** @type {Error} */ (e).message}`);
        continue;
      }
      const schema = this.deps.schemaOf?.(kind);
      if (schema) {
        const check = schema.safeParse(parsed);
        if (!check.success) {
          rejected.push(`${kind}/${file}`);
          this.deps.onReject?.(kind, file, `schema: ${check.error.issues[0]?.message ?? 'invalid'}`);
          // 覆盖文件坏了就回退默认同文件
          if (isOverride) {
            const fallback = await this.deps.readDefault(`${kind}/${file}`).catch(() => null);
            if (fallback?.ok && fallback.value !== null) {
              try {
                const reparsed = this.deps.parseYaml(fallback.value);
                const recheck = schema.safeParse(reparsed);
                if (recheck.success) {
                  items.push(recheck.data);
                  sources.push(`default-fallback:${kind}/${file}`);
                }
              } catch {
                /* 默认也坏，只能放弃 */
              }
            }
          }
          continue;
        }
        items.push(check.data);
        sources.push(`${isOverride ? 'user-data' : 'default'}:${kind}/${file}`);
        continue;
      }
      items.push(parsed);
      sources.push(`${isOverride ? 'user-data' : 'default'}:${kind}/${file}`);
    }

    return ok({ items, sources, rejected });
  }

  /**
   * 热加载订阅。回调异常不得影响运行中任务。
   * @param {(change: { kind: string, rejected: string[] }) => void} onChange
   * @param {CallCtx} ctx
   * @returns {() => void} unwatch
   */
  watch(onChange, ctx) {
    const wrapped = (/** @type {{kind:string, rejected:string[]}} */ change) => {
      try {
        onChange(change);
      } catch {
        /* 观察者自身异常，吞掉 */
      }
    };
    this.watchers.add(wrapped);
    void ctx;
    return () => this.watchers.delete(wrapped);
  }

  /** 供文件监听器在变更后调用。 @param {string} kind @param {string[]} rejected */
  emitChange(kind, rejected = []) {
    for (const w of this.watchers) w({ kind, rejected });
  }
}
