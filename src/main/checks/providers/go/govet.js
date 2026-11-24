/**
 * Go 检查 Provider：go vet（标准库自带，零安装成本）。
 * @module main/checks/providers/go/govet
 */
import { parseGo } from '../_shared.js';

export const govetProvider = {
  id: 'go-vet',
  language: 'go',
  label: 'go vet',
  command: { cmd: 'go', args: ['vet', './...'] },
  matches(exts) {
    return exts.some((e) => String(e) === 'go');
  },
  parse: (out) => parseGo(`${out.stdout}\n${out.stderr}`, 'go-vet'),
};
