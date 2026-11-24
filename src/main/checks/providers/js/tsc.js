/**
 * JS/TS 类型检查 Provider：`tsc --noEmit`（不产文件，只报诊断）。
 * 注意 --pretty false：彩色输出会带 ANSI 转义，破坏解析。
 * @module main/checks/providers/js/tsc
 */
import { parseTsc } from '../_shared.js';

export const tscProvider = {
  id: 'js-tsc',
  language: 'js',
  label: 'TypeScript 类型检查',
  command: { cmd: 'npx', args: ['tsc', '--noEmit', '--pretty', 'false'] },
  /** @param {(string|undefined)[]} exts */
  matches(exts) {
    return exts.some((e) => ['ts', 'tsx', 'js', 'mjs', 'cjs'].includes(String(e)));
  },
  /** @param {{stdout:string, stderr:string}} out */
  parse: (out) => parseTsc(`${out.stdout}\n${out.stderr}`, 'js-tsc'),
};
