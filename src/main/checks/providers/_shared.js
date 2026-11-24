/**
 * 检查器公共层：统一 Diagnostic 契约 + 各工具输出解析。
 * 所有语言的 provider 只做两件事：`buildCommand(files)` 造命令、`parse(out)` 造诊断。
 * 解析器一律「容错」：格式变了就退化为 raw 文本 1 条，绝不让检查器本身崩掉主流程。
 * @module main/checks/providers/_shared
 */

/**
 * @typedef {'error'|'warning'|'info'} Severity
 * @typedef {object} Diagnostic
 * @property {string} provider  产生它的 provider id
 * @property {string} language
 * @property {string} [file]    相对工作区路径
 * @property {number} [line]
 * @property {number} [col]
 * @property {Severity} severity
 * @property {string} code      工具自己的规则号（如 TS2322 / no-unused-vars）
 * @property {string} message
 * @property {string} [raw]
 */

/**
 * @param {Partial<Diagnostic> & { provider: string, language: string, severity: Severity, code: string, message: string }} d
 * @returns {Diagnostic}
 */
export function diag(d) {
  return {
    provider: d.provider,
    language: d.language,
    file: d.file,
    line: d.line,
    col: d.col,
    severity: d.severity,
    code: d.code,
    message: String(d.message).trim().slice(0, 500),
    raw: d.raw,
  };
}

/** @param {string} s @returns {number|undefined} */
export function num(s) {
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * tsc 输出：`src/a.ts(12,5): error TS2322: Type 'x' is not assignable...`
 * @param {string} text @param {string} provider
 * @returns {Diagnostic[]}
 */
export function parseTsc(text, provider = 'js-tsc') {
  const out = [];
  const re = /^(.+?)\((\d+),(\d+)\):\s+(error|warning|info)\s+(TS\d+):\s+(.*)$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(
      diag({
        provider,
        language: 'js',
        file: m[1],
        line: num(m[2]),
        col: num(m[3]),
        severity: /** @type {Severity} */ (m[4]),
        code: m[5],
        message: m[6],
        raw: m[0],
      }),
    );
  }
  return out.length ? out : fallback(text, provider, 'js');
}

/**
 * eslint stylish 输出：
 * `/abs/src/a.js`
 * `  12:5  error  'x' is not defined  no-undef`
 * @param {string} text @param {string} provider @param {string} [cwd]
 */
export function parseEslint(text, provider = 'js-eslint', cwd = '') {
  const out = [];
  let file = '';
  for (const line of String(text).split(/\r?\n/)) {
    const f = /^\/(.+)$/.exec(line.trim());
    if (f && !line.includes(':')) {
      file = cwd ? f[1].replace(`${cwd.replace(/^\//, '')}/`, '') : f[1];
      continue;
    }
    const m = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.*?)\s{2,}([\w@/-]+)$/.exec(line);
    if (m && file) {
      out.push(
        diag({
          provider,
          language: 'js',
          file,
          line: num(m[1]),
          col: num(m[2]),
          severity: /** @type {Severity} */ (m[3]),
          code: m[5],
          message: m[4],
          raw: line,
        }),
      );
    }
  }
  return out.length ? out : fallback(text, provider, 'js');
}

/**
 * ruff：`src/a.py:12:5: F841 local variable 'x' is assigned but never used`
 * @param {string} text @param {string} provider
 */
export function parseRuff(text, provider = 'python-ruff') {
  const out = [];
  const re = /^(.+?):(\d+):(\d+):\s+([A-Z]+\d+)\s+(.*)$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(
      diag({
        provider,
        language: 'python',
        file: m[1],
        line: num(m[2]),
        col: num(m[3]),
        severity: 'warning',
        code: m[4],
        message: m[5],
        raw: m[0],
      }),
    );
  }
  return out.length ? out : fallback(text, provider, 'python');
}

/**
 * pyright：`/abs/a.py:12:5 - error: "x" is not defined (reportUndefinedVariable)`
 * @param {string} text @param {string} provider
 */
export function parsePyright(text, provider = 'python-pyright') {
  const out = [];
  const re = /^(.+?):(\d+):(\d+)\s+-\s+(error|warning|information):\s+(.*?)(?:\s+\(([\w.]+)\))?$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(
      diag({
        provider,
        language: 'python',
        file: m[1],
        line: num(m[2]),
        col: num(m[3]),
        severity: /** @type {Severity} */ (m[4] === 'information' ? 'info' : m[4]),
        code: m[6] ?? 'pyright',
        message: m[5],
        raw: m[0],
      }),
    );
  }
  return out.length ? out : fallback(text, provider, 'python');
}

/**
 * go vet / staticcheck：`./a.go:12:5: undefined: x`
 * @param {string} text @param {string} provider
 */
export function parseGo(text, provider = 'go-vet') {
  const out = [];
  const re = /^(?:\.\/)?(.+?\.go):(\d+):(\d+):\s+(.*)$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(
      diag({
        provider,
        language: 'go',
        file: m[1],
        line: num(m[2]),
        col: num(m[3]),
        severity: 'error',
        code: 'go',
        message: m[4],
        raw: m[0],
      }),
    );
  }
  return out.length ? out : fallback(text, provider, 'go');
}

/**
 * clippy / cargo：`warning: unused variable: \`x\` --> src/main.rs:3:9`
 * @param {string} text @param {string} provider
 */
export function parseCargo(text, provider = 'rust-clippy') {
  const out = [];
  const blocks = String(text).split(/\n(?=(?:warning|error)\b)/);
  for (const b of blocks) {
    const head = /^(warning|error)(?:\[(\w+)\])?:\s+(.*)$/m.exec(b);
    const loc = /-->\s+(.+?):(\d+):(\d+)/.exec(b);
    if (!head) continue;
    out.push(
      diag({
        provider,
        language: 'rust',
        file: loc?.[1] ?? '',
        line: num(loc?.[2] ?? ''),
        col: num(loc?.[3] ?? ''),
        severity: /** @type {Severity} */ (head[1]),
        code: head[2] ?? 'clippy',
        message: head[3],
        raw: b.slice(0, 300),
      }),
    );
  }
  return out.length ? out : fallback(text, provider, 'rust');
}

/**
 * clang-tidy：`/abs/a.cc:12:5: warning: ... [bugprone-x]`
 * @param {string} text @param {string} provider
 */
export function parseClangTidy(text, provider = 'cpp-clang-tidy') {
  const out = [];
  const re = /^(.+?):(\d+):(\d+):\s+(warning|error|note):\s+(.*?)(?:\s+\[([\w.,-]+)\])?$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(
      diag({
        provider,
        language: 'cpp',
        file: m[1],
        line: num(m[2]),
        col: num(m[3]),
        severity: /** @type {Severity} */ (m[4] === 'note' ? 'info' : m[4]),
        code: m[6] ?? 'clang-tidy',
        message: m[5],
        raw: m[0],
      }),
    );
  }
  return out.length ? out : fallback(text, provider, 'cpp');
}

/**
 * 解析不出结构就退化：有输出就当 info，避免"看不出问题"被误判为干净。
 * @param {string} text @param {string} provider @param {string} language
 * @returns {Diagnostic[]}
 */
export function fallback(text, provider, language) {
  const t = String(text ?? '').trim();
  if (!t) return [];
  return [
    diag({
      provider,
      language,
      severity: 'info',
      code: 'unparsed-output',
      message: t.slice(0, 400),
      raw: t.slice(0, 400),
    }),
  ];
}

/** 按扩展名推语言 @param {string} file */
export function languageOf(file) {
  const ext = String(file).split('.').pop()?.toLowerCase() ?? '';
  if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx'].includes(ext)) return 'js';
  if (['py'].includes(ext)) return 'python';
  if (['go'].includes(ext)) return 'go';
  if (['rs'].includes(ext)) return 'rust';
  if (['c', 'cc', 'cpp', 'cxx', 'h', 'hpp'].includes(ext)) return 'cpp';
  return null;
}
