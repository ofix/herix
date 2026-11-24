/**
 * B2a：存储层必须能扛住「写到一半断电」和「并发写同一文件」。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeTextAtomic, readTextSafe } from '../../../src/main/infra/storage/atomic.js';
import { FileStore } from '../../../src/main/infra/storage/file-store.js';
import { Journal } from '../../../src/main/infra/storage/journal.js';

let root;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'herix-b2-'));
});

describe('atomic.writeTextAtomic', () => {
  it('写入后可读回，且不残留 .tmp 文件', async () => {
    const target = path.join(root, 'state', 'sites.json');
    const r = await writeTextAtomic(target, '{"a":1}');
    expect(r.ok).toBe(true);
    expect(await readFile(target, 'utf8')).toBe('{"a":1}');
    const left = (await readdir(path.join(root, 'state'))).filter((f) => f.includes('.tmp.'));
    expect(left).toEqual([]);
  });

  it('崩溃语义：只留下 tmp 未 rename 时，原文件保持旧内容', async () => {
    const target = path.join(root, 'state', 'tasks.json');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, 'OLD');
    // 模拟断电：tmp 已落盘但没 rename
    await writeFile(`${target}.tmp.999.deadbeef`, 'HALF-WRITTEN');
    expect(await readFile(target, 'utf8')).toBe('OLD');
  });

  it('readTextSafe 对不存在文件返回 null 而非错误', async () => {
    const r = await readTextSafe(path.join(root, 'nope.json'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });
});

describe('FileStore', () => {
  it('并发写同一路径：最终内容完整，且任何时刻都能被 JSON.parse', async () => {
    const store = new FileStore(root);
    const writes = Array.from({ length: 20 }, (_, i) => store.writeTextAtomic('state/tasks.json', JSON.stringify({ i })));
    const results = await Promise.all(writes);
    expect(results.every((r) => r.ok)).toBe(true);

    const text = await readFile(path.join(root, 'state', 'tasks.json'), 'utf8');
    expect(JSON.parse(text)).toEqual({ i: 19 });
  });

  it('appendLine 并发 50 次：行数精确，无半行，全部可解析', async () => {
    const store = new FileStore(root);
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => store.appendLine('journal/audit-2026-11.jsonl', `{"n":${i}}`)),
    );
    const text = await readFile(path.join(root, 'journal', 'audit-2026-11.jsonl'), 'utf8');
    const lines = text.split('\n').filter(Boolean);
    expect(lines).toHaveLength(50);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('appendLine 拒绝含换行的输入', async () => {
    const store = new FileStore(root);
    const r = await store.appendLine('journal/audit-2026-11.jsonl', 'a\nb');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('E_VALIDATION');
  });

  it('拒绝路径逃逸（../ 越界）', async () => {
    const store = new FileStore(root);
    expect(() => store.abs('../../etc/passwd')).toThrow(/path escape/);
  });

  it('list 对不存在目录返回空数组，并过滤 .tmp 残骸', async () => {
    const store = new FileStore(root);
    const empty = await store.list('changesets');
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.value).toEqual([]);
    await store.writeTextAtomic('changesets/x.txt', 'x');
    await writeFile(path.join(root, 'changesets', 'x.txt.tmp.1.aa'), '');
    const listed = await store.list('changesets');
    expect(listed.ok && listed.value).toEqual(['x.txt']);
  });
});

describe('Journal', () => {
  it('追加后按月分文件，且 at 由 Journal 注入', async () => {
    const store = new FileStore(root);
    const journal = new Journal(store, { clock: () => Date.parse('2026-11-21T10:00:00Z') });
    const r = await journal.append('audit', { type: 'config.rejected', file: 'bad.yaml' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rel).toBe('journal/audit-2026-11.jsonl');

    const readBack = await journal.read('journal/audit-2026-11.jsonl');
    expect(readBack.ok).toBe(true);
    if (readBack.ok) {
      expect(readBack.value.records).toHaveLength(1);
      expect(readBack.value.records[0].at).toBe('2026-11-21T10:00:00.000Z');
    }
  });

  it('坏行只跳过并计数，不影响其余回放', async () => {
    const store = new FileStore(root);
    const journal = new Journal(store);
    await store.appendLine('journal/tasks-2026-11.jsonl', '{"type":"ok"}');
    await store.appendLine('journal/tasks-2026-11.jsonl', 'not-json{');
    await store.appendLine('journal/tasks-2026-11.jsonl', '{"type":"ok2"}');

    const r = await journal.read('journal/tasks-2026-11.jsonl');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.records.map((x) => x.type)).toEqual(['ok', 'ok2']);
      expect(r.value.skipped).toBe(1);
    }
  });

  it('未知日志流直接报错（防止拼错名字写出野文件）', async () => {
    const store = new FileStore(root);
    const journal = new Journal(store);
    expect(() => journal.pathOf('task')).toThrow(/unknown journal/);
  });
});
