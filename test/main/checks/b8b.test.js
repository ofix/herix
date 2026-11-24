/**
 * B8b：命令授权闸（一次性票据 + 白名单 + 摘要绑定）、无 shell 执行、多语言检查器。
 * 命令层全部用 fake spawn，避免在 CI 机器上真跑 eslint/clippy。
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { CommandPolicy, digestOf, defaultAllowlist } from '../../../src/main/sandbox/command-policy.js';
import { CommandRunner } from '../../../src/main/sandbox/command-runner.js';
import { CheckRegistry } from '../../../src/main/checks/registry.js';
import { CheckService } from '../../../src/main/checks/service.js';
import {
  diag, languageOf, parseTsc, parseEslint, parseRuff, parsePyright, parseGo, parseCargo, parseClangTidy, fallback,
} from '../../../src/main/checks/providers/_shared.js';

const WT = '/tmp/herix-wt';
const HASH = 'abc123';

/** 假 spawn：按 cmd 回放预置输出 */
function fakeSpawn(table = {}) {
  return (cmd, args) => {
    /** @type {any} */
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      const spec = table[cmd] ?? { code: 0, out: '' };
      if (spec.throw) return child.emit('error', new Error('ENOENT'));
      if (spec.out) child.stdout.emit('data', Buffer.from(spec.out));
      if (spec.err) child.stderr.emit('data', Buffer.from(spec.err));
      child.emit('close', spec.code ?? 0, null);
    });
    return child;
  };
}

describe('CommandPolicy', () => {
  const mk = (over = {}) => new CommandPolicy({ allowlist: defaultAllowlist(), clock: () => 1000, ...over });

  it('白名单精确到 args 前缀，`npm run evil` 不被放行', () => {
    const p = mk();
    expect(p.allowed('npx', ['tsc', '--noEmit'])).toBe(true);
    expect(p.allowed('npm', ['run', 'evil'])).toBe(false);
    expect(p.allowed('sh', ['-c', 'rm -rf /'])).toBe(false);
  });

  it('签票成功，authorize 通过', () => {
    const p = mk();
    const t = p.issue({ cmd: 'npx', args: ['tsc', '--noEmit'], cwd: WT, worktreeHash: HASH, approver: 'me' });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    const a = p.authorize({ ticketId: t.value.id, cmd: 'npx', args: ['tsc', '--noEmit'], cwd: WT, worktreeHash: HASH });
    expect(a.ok).toBe(true);
  });

  it('一次性：用第二次即失效', () => {
    const p = mk();
    const t = /** @type {any} */ (p.issue({ cmd: 'git', args: ['status'], cwd: WT, worktreeHash: HASH, approver: 'me' }));
    expect(p.authorize({ ticketId: t.value.id, cmd: 'git', args: ['status'], cwd: WT, worktreeHash: HASH }).ok).toBe(true);
    const again = p.authorize({ ticketId: t.value.id, cmd: 'git', args: ['status'], cwd: WT, worktreeHash: HASH });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('E_COMMAND_UNAUTHORIZED');
  });

  it('票据绑死命令：改 args 被拒（防 TOCTOU）', () => {
    const p = mk();
    const t = /** @type {any} */ (p.issue({ cmd: 'npx', args: ['tsc', '--noEmit'], cwd: WT, worktreeHash: HASH, approver: 'me' }));
    const bad = p.authorize({ ticketId: t.value.id, cmd: 'npx', args: ['tsc', '--watch'], cwd: WT, worktreeHash: HASH });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('E_COMMAND_UNAUTHORIZED');
  });

  it('换工作区哈希被拒', () => {
    const p = mk();
    const t = /** @type {any} */ (p.issue({ cmd: 'npx', args: ['tsc'], cwd: WT, worktreeHash: HASH, approver: 'me' }));
    expect(p.authorize({ ticketId: t.value.id, cmd: 'npx', args: ['tsc'], cwd: WT, worktreeHash: 'other' }).ok).toBe(false);
  });

  it('超过 ttl 失效', () => {
    let now = 1000;
    const p = new CommandPolicy({ clock: () => now, ttlMs: 5000 });
    const t = /** @type {any} */ (p.issue({ cmd: 'git', args: ['status'], cwd: WT, worktreeHash: HASH, approver: 'me' }));
    now = 7000;
    const r = p.authorize({ ticketId: t.value.id, cmd: 'git', args: ['status'], cwd: WT, worktreeHash: HASH });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('过期');
  });

  it('非白名单命令签不出票', () => {
    const r = mk().issue({ cmd: 'rm', args: ['-rf', '/'], cwd: WT, worktreeHash: HASH, approver: 'me' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('E_COMMAND_DENIED');
  });

  it('缺审批人签不出票', () => {
    expect(mk().issue({ cmd: 'git', args: ['status'], cwd: WT, worktreeHash: HASH, approver: '' }).ok).toBe(false);
  });

  it('digest 对参数顺序敏感', () => {
    expect(digestOf('a', ['x', 'y'], WT, HASH)).not.toBe(digestOf('a', ['y', 'x'], WT, HASH));
  });

  it('batch 票据可复用，revoke 后失效', () => {
    const p = mk();
    const t = /** @type {any} */ (p.issue({ cmd: 'npx', args: ['eslint'], cwd: WT, worktreeHash: HASH, approver: 'me', scope: 'batch' }));
    expect(p.authorize({ ticketId: t.value.id, cmd: 'npx', args: ['eslint'], cwd: WT, worktreeHash: HASH }).ok).toBe(true);
    expect(p.authorize({ ticketId: t.value.id, cmd: 'npx', args: ['eslint'], cwd: WT, worktreeHash: HASH }).ok).toBe(true);
    p.revoke(t.value.id);
    expect(p.authorize({ ticketId: t.value.id, cmd: 'npx', args: ['eslint'], cwd: WT, worktreeHash: HASH }).ok).toBe(false);
  });
});

describe('CommandRunner', () => {
  const mkRunner = (spawnImpl) => {
    const policy = new CommandPolicy({ clock: () => 1000 });
    const runner = new CommandRunner({ policy, spawnImpl, clock: () => 1000 });
    const ticket = /** @type {any} */ (
      policy.issue({ cmd: 'git', args: ['status'], cwd: WT, worktreeHash: HASH, approver: 'me' })
    ).value;
    return { runner, ticket };
  };

  it('正常执行返回 stdout 与退出码', async () => {
    const { runner, ticket } = mkRunner(fakeSpawn({ git: { code: 0, out: 'ok\n' } }));
    const r = await runner.run({ ticketId: ticket.id, cmd: 'git', args: ['status'], cwd: WT, worktreePath: WT, worktreeHash: HASH });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.stdout).toBe('ok\n');
      expect(r.value.code).toBe(0);
    }
  });

  it('非 0 退出码不是异常（检查器"有问题"就是这样）', async () => {
    const { runner, ticket } = mkRunner(fakeSpawn({ git: { code: 1, out: 'diff exists' } }));
    const r = await runner.run({ ticketId: ticket.id, cmd: 'git', args: ['status'], cwd: WT, worktreePath: WT, worktreeHash: HASH });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.code).toBe(1);
  });

  it('cwd 越界被拒', async () => {
    const { runner, ticket } = mkRunner(fakeSpawn());
    const r = await runner.run({ ticketId: ticket.id, cmd: 'git', args: ['status'], cwd: '/etc', worktreePath: WT, worktreeHash: HASH });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('E_COMMAND_DENIED');
  });

  it('票据不匹配直接拒，不启动进程', async () => {
    let spawned = false;
    const { runner, ticket } = mkRunner((...a) => {
      spawned = true;
      return fakeSpawn()(...a);
    });
    const r = await runner.run({ ticketId: ticket.id, cmd: 'git', args: ['diff'], cwd: WT, worktreePath: WT, worktreeHash: HASH });
    expect(r.ok).toBe(false);
    expect(spawned).toBe(false);
  });

  it('命令不存在（spawn error）返回 E_TOOL_MISSING', async () => {
    const { runner, ticket } = mkRunner(fakeSpawn({ git: { throw: true } }));
    const r = await runner.run({ ticketId: ticket.id, cmd: 'git', args: ['status'], cwd: WT, worktreePath: WT, worktreeHash: HASH });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('E_TOOL_MISSING');
  });
});

describe('Provider 解析器', () => {
  it('tsc 解析出文件/行/列/错误码', () => {
    const d = parseTsc("src/a.js(12,5): error TS2322: Type 'string' is not assignable to type 'number'.", 'js-tsc');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ file: 'src/a.js', line: 12, col: 5, severity: 'error', code: 'TS2322' });
  });

  it('eslint unix 格式解析', () => {
    const d = parseEslint('/abs/src/a.js\n  12:5  error  x is not defined  no-undef\n');
    expect(d[0]).toMatchObject({ file: 'abs/src/a.js', line: 12, col: 5, severity: 'error', code: 'no-undef' });
  });

  it('ruff 解析', () => {
    const d = parseRuff("src/a.py:12:5: F841 local variable 'x' is assigned but never used");
    expect(d[0]).toMatchObject({ file: 'src/a.py', language: 'python', code: 'F841' });
  });

  it('pyright 解析并把 information 归一为 info', () => {
    const d = parsePyright('/abs/a.py:3:1 - information: 提示 (reportX)');
    expect(d[0].severity).toBe('info');
    expect(d[0].code).toBe('reportX');
  });

  it('go vet 解析', () => {
    const d = parseGo('./a.go:7:2: undefined: x');
    expect(d[0]).toMatchObject({ file: 'a.go', line: 7, language: 'go' });
  });

  it('cargo clippy 解析块', () => {
    const txt = 'warning: unused variable: `x`\n --> src/main.rs:3:9\n  |\n';
    const d = parseCargo(txt);
    expect(d[0]).toMatchObject({ file: 'src/main.rs', line: 3, severity: 'warning' });
  });

  it('clang-tidy 解析', () => {
    const d = parseClangTidy('/abs/a.cc:12:5: warning: use nullptr [modernize-use-nullptr]');
    expect(d[0]).toMatchObject({ language: 'cpp', code: 'modernize-use-nullptr' });
  });

  it('无法解析时退化为 1 条 info 而不是空数组（空=干净，误判危险）', () => {
    const d = fallback('some weird output', 'p', 'js');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ severity: 'info', code: 'unparsed-output' });
    expect(fallback('', 'p', 'js')).toEqual([]);
  });

  it('languageOf 覆盖五语言', () => {
    expect(languageOf('a.ts')).toBe('js');
    expect(languageOf('a.py')).toBe('python');
    expect(languageOf('a.go')).toBe('go');
    expect(languageOf('a.rs')).toBe('rust');
    expect(languageOf('a.cc')).toBe('cpp');
    expect(languageOf('a.md')).toBeNull();
  });

  it('diag 截断超长 message', () => {
    expect(diag({ provider: 'p', language: 'js', severity: 'info', code: 'c', message: 'x'.repeat(900) }).message.length).toBe(500);
  });
});

describe('CheckRegistry', () => {
  it('默认注册 8 个 provider', () => {
    expect(new CheckRegistry().all()).toHaveLength(8);
  });

  it('重复注册被拒', () => {
    const r = new CheckRegistry();
    expect(r.register({ id: 'js-tsc', language: 'js', parse: () => [] }).ok).toBe(false);
  });

  it('detect 按扩展名挑语言与 provider', () => {
    const d = new CheckRegistry().detect(['a.ts', 'b.py', 'c.md']);
    expect(d.languages.sort()).toEqual(['js', 'python']);
    expect(d.providers.map((p) => p.id).sort()).toEqual(['js-eslint', 'js-tsc', 'python-pyright', 'python-ruff']);
  });

  it('无匹配文件返回空 provider 列表', () => {
    expect(new CheckRegistry().detect(['README.md']).providers).toEqual([]);
  });

  it('select 对不适用的 provider 报错', () => {
    const r = new CheckRegistry().select({ providerId: 'go-vet', files: ['a.ts'] });
    expect(r.ok).toBe(false);
  });
});

describe('CheckService', () => {
  const mkService = (table) => {
    const policy = new CommandPolicy({ clock: () => 1000 });
    const registry = new CheckRegistry();
    const runner = new CommandRunner({ policy, spawnImpl: fakeSpawn(table), clock: () => 1000 });
    return new CheckService({ registry, policy, runner, clock: () => 1000 });
  };

  it('error 诊断让 pass=false，并按严重度排序', async () => {
    const svc = mkService({ npx: { code: 2, err: "a.ts(1,1): error TS1: bad\na.ts(2,1): warning TS2: warn" } });
    const r = await svc.run({ files: ['a.ts'], worktreePath: WT, worktreeHash: HASH, providerIds: ['js-tsc'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.pass).toBe(false);
    expect(r.value.diagnostics[0].severity).toBe('error');
    expect(r.value.diagnostics[1].severity).toBe('warning');
  });

  it('工具缺失不阻断，产 info 诊断', async () => {
    const svc = mkService({ npx: { code: 127, err: 'command not found' } });
    const r = await svc.run({ files: ['a.ts'], worktreePath: WT, worktreeHash: HASH, providerIds: ['js-tsc'] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pass).toBe(true); // 只有 info
      expect(r.value.diagnostics.some((d) => d.code === 'tool-missing')).toBe(true);
    }
  });

  it('无匹配文件时直接 pass，不跑命令', async () => {
    const r = await mkService({}).run({ files: ['README.md'], worktreePath: WT, worktreeHash: HASH });
    expect(r.ok && r.value.pass).toBe(true);
    expect(r.ok && r.value.ran).toEqual([]);
  });

  it('toFeedback 只带 error/warning 并限条数', () => {
    const ds = [
      diag({ provider: 'p', language: 'js', severity: 'error', code: 'E1', message: '坏', file: 'a.ts', line: 1 }),
      diag({ provider: 'p', language: 'js', severity: 'info', code: 'I1', message: '噪音' }),
    ];
    const f = CheckService.toFeedback(ds);
    expect(f.ok).toBe(true);
    if (f.ok) {
      expect(f.value).toContain('坏');
      expect(f.value).not.toContain('噪音');
    }
    expect(CheckService.toFeedback([]).ok).toBe(false);
  });
});
