/**
 * Provider 汇总入口：按语言分组的全部检查器。
 * 新增语言只需在此注册，Service 与 Registry 自动发现。
 * @module main/checks/providers
 */
import { tscProvider } from './js/tsc.js';
import { eslintProvider } from './js/eslint.js';
import { ruffProvider } from './python/ruff.js';
import { pyrightProvider } from './python/pyright.js';
import { govetProvider } from './go/govet.js';
import { staticcheckProvider } from './go/staticcheck.js';
import { clippyProvider } from './rust/clippy.js';
import { clangTidyProvider } from './cpp/clang-tidy.js';

export const ALL_PROVIDERS = [
  tscProvider,
  eslintProvider,
  ruffProvider,
  pyrightProvider,
  govetProvider,
  staticcheckProvider,
  clippyProvider,
  clangTidyProvider,
];
