/**
 * Python 静态检查 Provider：ruff（极快、默认规则集足够）。
 * @module main/checks/providers/python/ruff
 */
import { parseRuff } from '../_shared.js';

export const ruffProvider = {
  id: 'python-ruff',
  language: 'python',
  label: 'Ruff 静态检查',
  command: { cmd: 'ruff', args: ['check', '--output-format', 'concise', '.'] },
  matches(exts) {
    return exts.some((e) => String(e) === 'py');
  },
  parse: (out) => parseRuff(`${out.stdout}\n${out.stderr}`, 'python-ruff'),
};
