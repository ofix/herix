/**
 * CheckRegistry：Provider 注册与"按文件挑检查器"。
 * 设计取舍：不做插件热加载（安全面太大），只做静态注册 + 语言匹配；
 * 同一语言常有「快」和「深」两个 Provider，全部跑，让诊断更全。
 * @module main/checks/registry
 */
import { ok, err } from '../../libs/utils/result.js';
import { ERROR_CODE } from '../../libs/utils/errors.js';
import { languageOf } from './providers/_shared.js';
import { ALL_PROVIDERS } from './providers/index.js';

export class CheckRegistry {
  /** @param {{ providers?: any[] }} [opts] */
  constructor(opts = {}) {
    /** @type {Map<string, any>} */
    this.map = new Map();
    for (const p of opts.providers ?? ALL_PROVIDERS) this.register(p);
  }

  /** @param {any} provider */
  register(provider) {
    if (!provider?.id) return err(ERROR_CODE.VALIDATION, 'Provider 缺少 id');
    if (this.map.has(provider.id)) return err(ERROR_CODE.VALIDATION, `Provider 重复注册：${provider.id}`);
    for (const k of ['language', 'parse']) {
      if (!provider[k]) return err(ERROR_CODE.VALIDATION, `Provider ${provider.id} 缺少 ${k}`);
    }
    this.map.set(provider.id, provider);
    return ok({ id: provider.id });
  }

  /** @param {string} id */
  get(id) {
    const p = this.map.get(id);
    return p ? ok(p) : err(ERROR_CODE.VALIDATION, `Provider 未注册：${id}`);
  }

  /** @returns {any[]} */
  all() {
    return [...this.map.values()];
  }

  /** @param {string} language @param {string} [id] */
  listByLanguage(language, id) {
    if (id) return this.get(id);
    return ok(this.all().filter((p) => p.language === language));
  }

  /**
   * 按文件扩展名挑检查器。没有任何匹配文件 → 空数组（不是错误）。
   * @param {string[]} files
   * @returns {{ providers: any[], languages: string[] }}
   */
  detect(files) {
    const langs = new Set();
    for (const f of files ?? []) {
      const l = languageOf(f);
      if (l) langs.add(l);
    }
    const providers = this.all().filter((p) => langs.has(p.language));
    return { providers, languages: [...langs] };
  }

  /**
   * 只跑指定 provider（人工点名排查用）。
   * @param {{ providerId: string, files: string[] }} args
   */
  select({ providerId, files }) {
    const r = this.get(providerId);
    if (!r.ok) return r;
    const exts = (files ?? []).map((f) => String(f).split('.').pop() ?? '');
    if (typeof r.value.matches === 'function' && !r.value.matches(exts)) {
      return err(ERROR_CODE.VALIDATION, `Provider ${providerId} 不适用于这些文件`);
    }
    return ok([r.value]);
  }
}
