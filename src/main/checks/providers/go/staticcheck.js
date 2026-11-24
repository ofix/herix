/**
 * Go 深度检查 Provider：staticcheck（vet 覆盖不到的死代码/性能问题）。
 * @module main/checks/providers/go/staticcheck
 */
import { parseGo } from '../_shared.js';

export const staticcheckProvider = {
  id: 'go-staticcheck',
  language: 'go',
  label: 'staticcheck',
  command: { cmd: 'staticcheck', args: ['./...'] },
  matches(exts) {
    return exts.some((e) => String(e) === 'go');
  },
  parse: (out) => parseGo(`${out.stdout}\n${out.stderr}`, 'go-staticcheck'),
};
