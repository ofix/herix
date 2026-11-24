/**
 * C/C++ 检查 Provider：clang-tidy（需 compile_commands.json，缺失时退化为直接列文件）。
 * @module main/checks/providers/cpp/clang-tidy
 */
import { parseClangTidy } from '../_shared.js';

export const clangTidyProvider = {
  id: 'cpp-clang-tidy',
  language: 'cpp',
  label: 'clang-tidy',
  /** @param {{files?: string[]}} ctx */
  buildCommand(ctx = {}) {
    const srcs = (ctx.files ?? []).filter((f) => /\.(cc|cpp|cxx|c)$/.test(f)).slice(0, 20);
    return { cmd: 'clang-tidy', args: [...srcs, '--', '-std=c++20'] };
  },
  matches(exts) {
    return exts.some((e) => ['c', 'cc', 'cpp', 'cxx', 'h', 'hpp'].includes(String(e)));
  },
  parse: (out) => parseClangTidy(`${out.stdout}\n${out.stderr}`, 'cpp-clang-tidy'),
};
