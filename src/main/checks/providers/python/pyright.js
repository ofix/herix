/**
 * Python 类型检查 Provider：pyright --outputjson 太脆，用默认文本输出 + 容错解析。
 * @module main/checks/providers/python/pyright
 */
import { parsePyright } from '../_shared.js';

export const pyrightProvider = {
  id: 'python-pyright',
  language: 'python',
  label: 'Pyright 类型检查',
  command: { cmd: 'pyright', args: ['--outputjson=false', '.'] },
  matches(exts) {
    return exts.some((e) => String(e) === 'py');
  },
  parse: (out) => parsePyright(`${out.stdout}\n${out.stderr}`, 'python-pyright'),
};
