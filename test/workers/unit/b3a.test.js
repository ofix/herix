/**
 * B3a：ElementParser / ReplyAssembler / FrameIO 三件纯逻辑必须可单测（不开浏览器）。
 */
import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { parse, generate, classify, healingChain, tokenize } from '../../../src/workers/playwright-worker/element-parser.js';
import { ReplyAssembler, mergeSnapshot, fnv1a } from '../../../src/workers/playwright-worker/reply-assembler.js';
import { FrameIO, logToStderr } from '../../../src/libs/utils/frame-io.js';
import { FRAME_LIMIT } from '../../../src/libs/schemas/index.js';

/** @param {Partial<any>} over
 * @returns {any} */
const node = (over) => ({
  tag: 'div',
  visible: true,
  role: undefined,
  name: undefined,
  text: undefined,
  placeholder: undefined,
  type: undefined,
  id: undefined,
  testId: undefined,
  path: undefined,
  disabled: false,
  ...over,
});

describe('ElementParser: 分类与 selector 生成', () => {
  it('优先级 testId > 稳定 id > role+name > placeholder > path', () => {
    expect(generate(node({ testId: 'send', id: 'btn-1' })).strategy).toBe('testId');
    expect(generate(node({ id: 'send-btn' })).selector).toBe('#send-btn');
    expect(generate(node({ role: 'button', name: '发送' })).selector).toBe('role=button[name="发送"]');
    expect(generate(node({ placeholder: '有什么可以帮你的？' })).selector).toBe('[placeholder="有什么可以帮你的？"]');
    expect(generate(node({ path: 'div > span' })).strategy).toBe('path');
  });

  it('不稳定的框架生成 id 不被当作强 selector', () => {
    expect(generate(node({ id: 'react-select-2-input', path: 'div > input' })).strategy).toBe('path');
    expect(generate(node({ id: 'el-id-123456', path: 'div > input' })).strategy).toBe('path');
  });

  it('classify 覆盖输入框/按钮/链接', () => {
    expect(classify(node({ tag: 'textarea' }))).toBe('input');
    expect(classify(node({ role: 'textbox' }))).toBe('input');
    expect(classify(node({ tag: 'input', type: 'submit' }))).toBe('button');
    expect(classify(node({ tag: 'button' }))).toBe('button');
    expect(classify(node({ tag: 'a' }))).toBe('link');
    expect(classify(node({ tag: 'span' }))).toBe('other');
  });
});

describe('ElementParser: parse', () => {
  it('过滤不可见/禁用元素，并按分数降序', () => {
    const snap = [
      node({ tag: 'button', path: 'div > b1' }),
      node({ tag: 'button', testId: 'send-btn' }),
      node({ tag: 'button', visible: false, testId: 'hidden' }),
      node({ tag: 'button', disabled: true, testId: 'disabled' }),
    ];
    const r = parse(snap);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.map((e) => e.node.testId ?? 'path')).toEqual(['send-btn', 'path']);
      expect(r.value[0].score).toBeGreaterThan(r.value[1].score);
    }
  });

  it('按 kind 过滤，只取输入框', () => {
    const snap = [node({ tag: 'textarea', placeholder: 'ask' }), node({ tag: 'button', name: '发送' })];
    const r = parse(snap, { kinds: ['input'] });
    if (r.ok) expect(r.value).toHaveLength(1);
  });

  it('非数组输入返回 err 而不是抛', () => {
    const r = parse(/** @type {any} */ ('nope'));
    expect(r.ok).toBe(false);
  });
});

describe('ElementParser: 自愈链', () => {
  it('原 selector 失效后给出语义相近候选', () => {
    const snap = [
      node({ tag: 'button', role: 'button', name: '发送' }),
      node({ tag: 'button', role: 'button', name: '停止生成' }),
      node({ tag: 'textarea', placeholder: '输入你的问题' }),
    ];
    const r = healingChain('[data-testid="send-btn"]', snap, { kind: 'button' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.length).toBeGreaterThan(0);
      expect(r.value[0].selector).toContain('发送');
      expect(r.value.every((c) => c.selector !== '[data-testid="send-btn"]')).toBe(true);
    }
  });

  it('快照里完全没有候选时返回 err', () => {
    const r = healingChain('#gone', [node({ tag: 'span', text: '仅文本' })]);
    expect(r.ok).toBe(false);
  });

  it('tokenize 去掉符号与单字', () => {
    expect(tokenize('[data-testid="send-btn"]')).toEqual(['data', 'testid', 'send', 'btn']);
  });
});

describe('ReplyAssembler: 累积快照与增量两种喂法都能收敛', () => {
  it('累积快照：只追加增量', () => {
    const a = new ReplyAssembler({ idleMs: 1000 }).start(0);
    expect(a.feed('今天', 10).appended).toBe('今天');
    expect(a.feed('今天天气', 20).appended).toBe('天气');
    expect(a.snapshot().text).toBe('今天天气');
    expect(a.snapshot().chunks).toBe(2);
  });

  it('迟到的旧快照不会回退文本', () => {
    expect(mergeSnapshot('abcdef', 'abc')).toBe('');
    expect(mergeSnapshot('abc', 'abcdef')).toBe('def');
    expect(mergeSnapshot('abc', 'xyz')).toBe('xyz');
  });

  it('静默超时判定 idle', () => {
    const a = new ReplyAssembler({ idleMs: 1000, stableHits: 99 }).start(0);
    a.feed('答完了', 100);
    expect(a.tick(200)).toBe(false);
    expect(a.tick(1200)).toBe(true);
    expect(a.snapshot().reason).toBe('idle');
  });

  it('内容稳定 N 次判定 stable', () => {
    const a = new ReplyAssembler({ idleMs: 99999, stableHits: 2 }).start(0);
    a.feed('AB', 10);
    a.feed('AB', 20);
    a.feed('AB', 30);
    expect(a.tick(40)).toBe(true);
    expect(a.snapshot().reason).toBe('stable');
  });

  it('硬超时优先判定 timeout', () => {
    const a = new ReplyAssembler({ idleMs: 1, stableHits: 99, hardTimeoutMs: 500 }).start(0);
    a.feed('x', 10);
    expect(a.tick(600)).toBe(true);
    expect(a.snapshot().reason).toBe('timeout');
  });

  it('站点信号：空回复不算结束，非空才算', () => {
    const a = new ReplyAssembler().start(0);
    expect(a.signalDone()).toBe(false);
    a.feed('ok', 10);
    expect(a.signalDone()).toBe(true);
    expect(a.snapshot().reason).toBe('signal');
  });

  it('结束后再喂分片不会重复追加（reason 已锁定）', () => {
    const a = new ReplyAssembler({ idleMs: 1 }).start(0);
    a.feed('done', 10);
    a.tick(20);
    a.feed('trailing', 30);
    expect(a.snapshot().text).toBe('donetrailing');
    expect(a.snapshot().reason).toBe('idle');
  });

  it('fnv1a 对相同内容稳定', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
  });
});

describe('FrameIO: stdio 收发', () => {
  function makeIO() {
    const input = new PassThrough();
    const output = new PassThrough();
    /** @type {any[]} */
    const frames = [];
    /** @type {any[]} */
    const bad = [];
    const io = new FrameIO({
      input,
      output,
      onFrame: (f) => frames.push(f),
      onBadFrame: (reason, head) => bad.push({ reason, head }),
    });
    io.attach();
    return { input, output, io, frames, bad };
  }

  const goodLine = (seq = 1) => `${JSON.stringify({ type: 'ping', traceId: 'trc_00ff11ee', seq, ts: 1 })}\n`;

  it('按行解析，一次多帧', () => {
    const { input, frames } = makeIO();
    input.write(goodLine(1) + goodLine(2));
    expect(frames.map((f) => f.seq)).toEqual([1, 2]);
  });

  it('坏帧只上报不中断，后续好帧照常收到', () => {
    const { input, frames, bad } = makeIO();
    input.write('garbage{\n' + goodLine(3));
    expect(bad).toHaveLength(1);
    expect(frames).toHaveLength(1);
    expect(frames[0].seq).toBe(3);
  });

  it('回调抛异常也不会中断读取', () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const bad = [];
    const io = new FrameIO({
      input,
      output,
      onFrame: () => {
        throw new Error('handler bug');
      },
      onBadFrame: (r) => bad.push(r),
    });
    io.attach();
    input.write(goodLine(1) + goodLine(2));
    expect(bad.some((r) => r.includes('handler threw'))).toBe(true);
  });

  it('send 自动补 seq/ts 并只写 stdout 流', () => {
    const { io, output } = makeIO();
    /** @type {string[]} */
    const written = [];
    output.on('data', (c) => written.push(c.toString()));
    const r = io.send(/** @type {any} */ ({ type: 'ready', traceId: 'trc_00ff11ee' }));
    expect(r.ok).toBe(true);
    const parsed = JSON.parse(written[0].trim());
    expect(parsed.type).toBe('ready');
    expect(parsed.seq).toBe(1);
    expect(typeof parsed.ts).toBe('number');
  });

  it('单行残段超过上限被丢弃并上报', () => {
    const { input, bad } = makeIO();
    input.write('x'.repeat(FRAME_LIMIT.MAX_BYTES + 1));
    expect(bad.some((b) => String(b.reason).includes('oversize'))).toBe(true);
  });

  it('日志写 stderr，不写 stdout', () => {
    const chunks = [];
    const orig = process.stderr.write;
    process.stderr.write = (c) => {
      chunks.push(String(c));
      return true;
    };
    try {
      logToStderr('info', 'hello', { a: 1 });
    } finally {
      process.stderr.write = orig;
    }
    expect(JSON.parse(chunks[0].trim())).toMatchObject({ level: 'info', message: 'hello', a: 1 });
  });
});
