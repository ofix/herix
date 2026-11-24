/**
 * JS 规范检查 Provider：eslint `-f unix`（unix 格式每行一条，比 stylish 更稳）。
 * @module main/checks/providers/js/eslint
 */
import { parseEslint } from '../_shared.js';

export const eslintProvider = {
  id: 'js-eslint',
  language: 'js',
  label: 'ESLint 规范检查',
  command: { cmd: 'npx', args: ['eslint', '-f', 'unix', '--max-warnings', '0', '.'] },
  matches(exts) {
    return exts.some((e) => ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'].includes(String(e)));
  },
  /** eslint -f unix 输出形如 `/path/a.js:12:5: 'x' is not defined. [Error/no-undef]` */
  parse(out) {
    const text = `${out.stdout}\n${out.stderr}`;
    const mapped = text.replace(/^(.+?):(\d+):(\d+):\s+(.*?)\s+\[(Error|Warning)\/([\w@/-]+)\]$/gm,
      (_, f, l, c, msg, sev, code) => `  ${l}:${c}  ${sev.toLowerCase()}  ${msg}  ${code}`);
    const withFile = mapped.replace(/^(\/.+\.(?:js|mjs|cjs|ts|tsx|jsx))$/gm, '$1');
    return parseEslint(withFile, 'js-eslint');
  },
};
