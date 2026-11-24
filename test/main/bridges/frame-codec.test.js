/**
 * B2b：帧编解码必须「坏帧不崩、超长不炸、多余字段拒绝」；审计必须脱敏。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encodeFrame, decodeLine, decodeChunk } from '../../../src/main/bridges/frame-codec.js';
import { FRAME_LIMIT } from '../../../src/libs/schemas/index.js';
import { newTrace, childTrace, traceFields } from '../../../src/main/infra/observability/trace.js';
import { redact, redactText, MASK } from '../../../src/main/infra/security/redaction.js';
import { AuditLogger } from '../../../src/main/infra/observability/audit.js';
import { FileStore } from '../../../src/main/infra/storage/file-store.js';
import { Journal } from '../../../src/main/infra/storage/journal.js';

/** @type {import('../../../src/libs/contracts/protocol.js').Frame} */
const frame = { type: 'ping', traceId: 'trc_00ff11ee', seq: 7, ts: 1730000000000 };

describe('frame-codec.encodeFrame', () => {
  it('输出单行且带行尾换行', () => {
    const r = encodeFrame(frame);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.endsWith('\n')).toBe(true);
      expect(r.value.trimEnd().includes('\n')).toBe(false);
      expect(JSON.parse(r.value)).toEqual(frame);
    }
  });

  it('拒绝非法帧（不发出去，避免对端误判截断）', () => {
    const bad = encodeFrame(/** @type {any} */ ({ ...frame, type: 'resume' }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('E_VALIDATION');
  });

  it(`拒绝超过 ${FRAME_LIMIT.MAX_BYTES} 字节的帧`, () => {
    const huge = encodeFrame(/** @type {any} */ ({ ...frame, payload: { blob: 'x'.repeat(FRAME_LIMIT.MAX_BYTES + 10) } }));
    expect(huge.ok).toBe(false);
  });
});

describe('frame-codec.decodeLine', () => {
  it('接受合法帧与 CRLF 行尾', () => {
    const r1 = decodeLine(JSON.stringify(frame));
    const r2 = decodeLine(`${JSON.stringify(frame)}\r`);
    expect(r1.ok && r1.value?.type).toBe('ping');
    expect(r2.ok && r2.value?.type).toBe('ping');
  });

  it('空行返回 null（不是错误）', () => {
    const r = decodeLine('   ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  it('畸形 JSON 返回 err 而不抛异常', () => {
    expect(() => decodeLine('{"type":')).not.toThrow();
    const r = decodeLine('{"type":');
    expect(r.ok).toBe(false);
  });

  it('已合法 JSON 但结构错误 → 拒绝', () => {
    const r = decodeLine(JSON.stringify(/** @type {any} */ ({ ...frame, seq: '7' })));
    expect(r.ok).toBe(false);
  });

  it('超长行整行丢弃', () => {
    const r = decodeLine('x'.repeat(FRAME_LIMIT.MAX_BYTES + 1));
    expect(r.ok).toBe(false);
  });
});

describe('frame-codec.decodeChunk', () => {
  it('多行混合：好坏分开计数，好帧照常返回', () => {
    const good = JSON.stringify(frame);
    const chunk = [good, 'garbage', '', JSON.stringify({ ...frame, seq: 8 })].join('\n');
    const { frames, bad } = decodeChunk(chunk);
    expect(frames.map((f) => f.seq)).toEqual([7, 8]);
    expect(bad).toBe(1);
  });
});

describe('trace', () => {
  it('traceId 形如 trc_xxxxxxxx，子 trace 保留 parentId', () => {
    const parent = newTrace({ task: 'tsk_1' });
    expect(parent.traceId).toMatch(/^trc_[0-9a-f]{8}$/);
    const child = childTrace(parent, { round: '1' });
    expect(child.parentId).toBe(parent.traceId);
    expect(child.tags).toEqual({ task: 'tsk_1', round: '1' });
    expect(traceFields(child)).toEqual({ traceId: child.traceId, parentId: parent.traceId });
  });
});

describe('redaction', () => {
  it('敏感键遮盖，普通键保留，长字符串截断', () => {
    const out = /** @type {any} */ (
      redact({
        cookie: 'abc',
        nested: { apiKey: 'sk-123', note: 'ok' },
        long: 'y'.repeat(600),
        list: [{ token: 't' }],
      })
    );
    expect(out.cookie).toBe(MASK);
    expect(out.nested.apiKey).toBe(MASK);
    expect(out.nested.note).toBe('ok');
    expect(out.long).toContain('…(600)');
    expect(out.list[0].token).toBe(MASK);
  });

  it('自由文本遮盖 sk- 与 Bearer', () => {
    const t = redactText('Authorization: Bearer abcdefghijklmnop sk-abcdefghijklmnopqrst');
    expect(t).not.toContain('abcdefghijklmnopqrst');
  });
});

describe('AuditLogger', () => {
  let root;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'herix-audit-'));
  });

  it('落盘前已脱敏，且能读回', async () => {
    const journal = new Journal(new FileStore(root));
    const audit = new AuditLogger(journal);
    const r = await audit.record({
      action: 'command.approve',
      traceId: 'trc_00ff11ee',
      actor: 'user',
      target: 'tkt_0011aabb',
      detail: { cookie: 'secret-cookie', cmd: 'npm test' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const back = await journal.read(r.value.rel);
      expect(back.ok).toBe(true);
      if (back.ok) {
        expect(back.value.records[0].detail.cookie).toBe(MASK);
        expect(back.value.records[0].detail.cmd).toBe('npm test');
        expect(back.value.records[0].level).toBe('info');
      }
    }
  });

  it('command() 便捷方法带上批准人与命令哈希', async () => {
    const journal = new Journal(new FileStore(root));
    const audit = new AuditLogger(journal);
    const r = await audit.command({
      traceId: 'trc_00ff11ee',
      ticketId: 'tkt_0011aabb',
      approver: 'u_me',
      commandHash: 'sha256:abc',
      phase: 'denied',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const back = await journal.read(r.value.rel);
      if (back.ok) expect(back.value.records[0].level).toBe('warn');
    }
  });
});
