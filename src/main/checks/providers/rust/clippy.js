/**
 * Rust 检查 Provider：cargo clippy --message-format short。
 * @module main/checks/providers/rust/clippy
 */
import { parseCargo } from '../_shared.js';

export const clippyProvider = {
  id: 'rust-clippy',
  language: 'rust',
  label: 'cargo clippy',
  command: { cmd: 'cargo', args: ['clippy', '--all-targets', '--', '-D', 'warnings'] },
  matches(exts) {
    return exts.some((e) => String(e) === 'rs');
  },
  parse: (out) => parseCargo(`${out.stdout}\n${out.stderr}`, 'rust-clippy'),
};
