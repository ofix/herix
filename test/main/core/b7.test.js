/**
 * B7：model-io（提示词组装 / 产物抽取 / 畸形修复）与 conference（选人 / 轮次 / 投票 / 编排）。
 * 含"畸形输出 20 例 ≥18 例救回"的定量断言。
 */
import { describe, it, expect } from 'vitest';
import { PromptComposer, selfOutputSchema } from '../../../src/main/core/model-io/prompt-composer.js';
import { OutputExtractor, tryJson } from '../../../src/main/core/model-io/output-extractor.js';
import { ResponseRepair } from '../../../src/main/core/model-io/response-repair.js';
import { ParticipantPicker, MAX_PARTICIPANTS } from '../../../src/main/core/conference/participant-picker.js';
import { RoundRunner } from '../../../src/main/core/conference/round-runner.js';
import { VoteTally, fingerprint } from '../../../src/main/core/conference/vote-tally.js';
import { ConferenceManager, buildPeerPrompt } from '../../../src/main/core/conference/manager.js';

const GOOD = '```json\n{"summary":"改好了","confidence":0.8,"risks":[]}\n```\n```diff\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-old\n+new\n```\n';

describe('PromptComposer', () => {
  it('分段组装并统计各段长度', () => {
    const c = new PromptComposer();
    const r = c.compose({
      skill: { role: 'implementer', title: '实现者', promptTemplate: '只改必要的地方' },
      task: { prompt: '修复空指针' },
      context: { notes: ['项目是 ESM'], files: [{ path: 'src/a.js', body: 'export const a = 1;' }] },
    });
    expect(r.text).toContain('实现者');
    expect(r.text).toContain('src/a.js');
    expect(r.text).toContain('```diff');
    expect(r.sections.total).toBe(r.text.length);
  });

  it('超预算时截断并记录', () => {
    const c = new PromptComposer({ budget: { context: 200 } });
    const r = c.compose({ context: { files: [{ path: 'big.js', body: 'x'.repeat(1000) }] } });
    expect(r.truncated).toContain('context');
    expect(r.text).toContain('已截断');
  });

  it('总长受 maxChars 硬裁', () => {
    const c = new PromptComposer({ maxChars: 100 });
    expect(c.compose({ task: { prompt: 'y'.repeat(500) } }).text.length).toBeLessThanOrEqual(100);
  });

  it('输出协议同时要求 json 与 diff', () => {
    const s = selfOutputSchema();
    expect(s).toContain('```json');
    expect(s).toContain('```diff');
  });
});

describe('OutputExtractor', () => {
  const ex = new OutputExtractor();

  it('抽取 json + diff 双块', () => {
    const r = ex.extract(GOOD);
    expect(r.json.summary).toBe('改好了');
    expect(r.diff).toContain('--- a/src/a.js');
    expect(r.errors).toHaveLength(0);
  });

  it('无语言标的单块且含 --- a/ 时识别为 diff', () => {
    const r = ex.extract('```\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\n```');
    expect(r.diff).toContain('--- a/x.js');
  });

  it('JSON 尾逗号可救', () => {
    expect(tryJson('{"a":1,"b":[1,2,],}').ok).toBe(true);
  });

  it('全角引号可救', () => {
    expect(tryJson('｛“a”:1｝'.replace(/｛|｝/g, (m) => (m === '｛' ? '{' : '}'))).ok).toBe(true);
  });

  it('extractStrict 缺 diff 时报 E_PATCH_PARSE', () => {
    const r = ex.extractStrict('```json\n{"summary":"x"}\n```', { needDiff: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('E_PATCH_PARSE');
  });

  it('extractStrict 正常通过', () => {
    expect(ex.extractStrict(GOOD, { needJson: true, needDiff: true }).ok).toBe(true);
  });
});

describe('ResponseRepair（定量：20 例 ≥18 救回）', () => {
  /** 20 个真实形态的畸形样本 */
  const MALFORMED = [
    // 1-4 fence 未闭合
    GOOD.replace(/```\n$/, ''),
    '前言很多。'.repeat(60) + GOOD.replace(/\n```$/, ''),
    GOOD.slice(0, GOOD.length - 4),
    '```json\n{"summary":"ok"}\n```\n```diff\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b',
    // 5-8 前言杂话
    '好的，以下是我的方案：\n\n' + GOOD,
    '我将分三步说明。'.repeat(40) + GOOD,
    'Here is the result:\n' + GOOD,
    '下面是修改：\n'.repeat(30) + GOOD,
    // 9-12 全角引号 / 尾逗号
    GOOD.replace(/"summary"/, '\u201csummary\u201d'),
    GOOD.replace('"risks":[]', '"risks":[],'),
    GOOD.replace('"confidence":0.8', '"confidence":0.8,'),
    GOOD.replace('"summary":"改好了"', '\u201csummary\u201d:\u201c改好了\u201d'),
    // 13-16 diff 被包进 json
    '```json\n{"summary":"ok","diff":"--- a/x\\n+++ b/x\\n@@ -1 +1 @@\\n-a\\n+b"}\n```',
    '```json\n{"diff":"--- a/x\\n+++ b/x\\n@@ -1 +1 @@\\n-a\\n+b","confidence":1}\n```',
    '结论已给出。\n```json\n{"diff":"--- a/x\\n+++ b/x\\n@@ -1 +1 @@\\n-b\\n+c"}\n```',
    '说明一下再给：\n```json\n{"summary":"s","diff":"--- a/x\\n+++ b/x\\n@@ -1 +1 @@\\n-c\\n+d"}\n```',
    // 17-20 组合畸形
    '好的：\n' + GOOD.replace(/\n```$/, ''),
    GOOD.replace(/"summary"/, '\u201csummary\u201d').replace(/\n```$/, ''),
    '好的，以下是结论：\n' + '多余解释。'.repeat(30) + GOOD.replace(/```\n$/, ''),
    '以下：\n```json\n{"diff":"--- a/x\\n+++ b/x\\n@@ -1 +1 @@\\n-e\\n+f",}\n```',
  ];

  it('样本数正好 20', () => expect(MALFORMED).toHaveLength(20));

  it('≥18 例经「修复+校验」救回', () => {
    const ex = new OutputExtractor();
    const repair = new ResponseRepair({ extractStrict: (raw, req) => ex.extractStrict(raw, req) });
    let saved = 0;
    /** @type {number[]} */
    const failedAt = [];
    MALFORMED.forEach((raw, i) => {
      let t = raw;
      for (let k = 0; k < 2; k += 1) t = repair.repairOnce(t, { needJson: true, needDiff: true }).text;
      if (ex.extractStrict(t, { needJson: true, needDiff: true }).ok) saved += 1;
      else failedAt.push(i + 1);
    });
    expect(saved).toBeGreaterThanOrEqual(18);
    expect(failedAt.length).toBeLessThanOrEqual(2);
  });

  it('fetchAndRepair 首次失败后重取成功，并统计', async () => {
    const ex = new OutputExtractor();
    const repair = new ResponseRepair({ maxAttempts: 3, extractStrict: (raw, req) => ex.extractStrict(raw, req) });
    let n = 0;
    const r = await repair.fetchAndRepair({
      req: { needDiff: true },
      fetch: async () => (n++ === 0 ? '完全不是代码的回答' : GOOD),
    });
    expect(r.ok).toBe(true);
    expect(r.value.attempts).toBe(2);
    expect(repair.snapshot().repaired).toBe(1);
  });

  it('三次都救不回时返回 E_PATCH_PARSE 而不抛', async () => {
    const repair = new ResponseRepair({ maxAttempts: 2, extractStrict: () => ({ ok: false, error: { message: 'bad' } }) });
    const r = await repair.fetchAndRepair({ fetch: async () => 'noise' });
    expect(r.ok).toBe(false);
    expect(repair.snapshot().failed).toBe(1);
  });
});

describe('ParticipantPicker', () => {
  const cand = (siteId, role) => ({ siteId, role, skillId: `${role}-1`, health: { failureStreak: 0 } });

  it('按角色各取一人且站点不重复', () => {
    const p = new ParticipantPicker();
    const r = p.pick({ candidates: [cand('s1', 'implementer'), cand('s2', 'reviewer'), cand('s3', 'tester')] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.picked).toHaveLength(3);
    expect(new Set(r.value.picked.map((x) => x.siteId)).size).toBe(3);
  });

  it('参会人数硬上限 4', () => {
    const p = new ParticipantPicker();
    const roles = ['implementer', 'reviewer', 'tester', 'architect', 'auditor', 'po'];
    const r = p.pick({ candidates: roles.map((x, i) => cand(`s${i}`, x)), requiredRoles: roles });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.picked.length).toBeLessThanOrEqual(MAX_PARTICIPANTS);
  });

  it('只有 1 个站点时无法成会', () => {
    const r = new ParticipantPicker().pick({ candidates: [cand('s1', 'implementer')] });
    expect(r.ok).toBe(false);
  });

  it('缺失角色标记 degraded 并用剩余站点补位', () => {
    const r = new ParticipantPicker().pick({
      candidates: [cand('s1', 'implementer'), cand('s2', 'unknown')],
      requiredRoles: ['implementer', 'reviewer'],
    });
    expect(r.ok && r.value.degraded).toBe(true);
    expect(r.ok && r.value.missingRoles).toContain('reviewer');
  });

  it('refill 用同角色替补顶替失败者', () => {
    const p = new ParticipantPicker();
    const r = p.refill({
      picked: [cand('s1', 'implementer'), cand('s2', 'reviewer')],
      failedSiteIds: ['s2'],
      candidates: [cand('s3', 'reviewer')],
    });
    expect(r.ok && r.value.picked.map((x) => x.siteId)).toEqual(['s1', 's3']);
  });
});

describe('RoundRunner', () => {
  const P = [
    { siteId: 's1', role: 'a' },
    { siteId: 's2', role: 'b' },
    { siteId: 's3', role: 'c' },
  ];

  it('并发返回两票即成功', async () => {
    const r = await new RoundRunner({ concurrency: 4 }).runRound({
      participants: P,
      prompt: 'x',
      send: async (p) => `答案-${p.siteId}`,
    });
    expect(r.ok && r.value.replies).toHaveLength(3);
    expect(r.ok && r.value.degraded).toBe(false);
  });

  it('超时站点被剔除，剩余仍成会', async () => {
    const r = await new RoundRunner({ timeoutMs: 30 }).runRound({
      participants: P,
      prompt: 'x',
      send: (p) => (p.siteId === 's3' ? new Promise(() => {}) : Promise.resolve('ok')),
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.failed.map((f) => f.siteId)).toEqual(['s3']);
    expect(r.ok && r.value.degraded).toBe(true);
  });

  it('响应不足法定人数返回 E_CONFERENCE_NO_QUORUM', async () => {
    const r = await new RoundRunner({ timeoutMs: 20 }).runRound({
      participants: P,
      prompt: 'x',
      send: () => new Promise(() => {}),
    });
    expect(r.ok).toBe(false);
  });
});

describe('VoteTally', () => {
  it('同义表述归为一票', () => {
    expect(fingerprint('修复 空指针!')).toBe(fingerprint('修复空指针'));
  });

  it('多数胜出', () => {
    const t = new VoteTally();
    const r = t.tally([
      { siteId: 's1', text: '方案A' },
      { siteId: 's2', text: '方案A' },
      { siteId: 's3', text: '方案B' },
    ]);
    expect(r.ok && r.value.winner?.voters).toEqual(['s1', 's2']);
  });

  it('平票时带 patch 的保守方胜', () => {
    const r = new VoteTally().tally([
      { siteId: 's1', text: '甲' },
      { siteId: 's2', text: '乙', hasPatch: true },
    ]);
    expect(r.ok && r.value.tie).toBe(true);
    expect(r.ok && r.value.winner?.label).toBe('乙');
  });

  it('平票且无 patch 时交人工（winner=null）', () => {
    const r = new VoteTally().tally([{ siteId: 's1', text: '甲' }, { siteId: 's2', text: '乙' }]);
    expect(r.ok && r.value.winner).toBeNull();
  });

  it('空投票返回 err', () => {
    expect(new VoteTally().tally([]).ok).toBe(false);
  });
});

describe('ConferenceManager', () => {
  const participants = [
    { siteId: 's1', role: 'implementer', skillId: 'i', health: { failureStreak: 0 } },
    { siteId: 's2', role: 'reviewer', skillId: 'r', health: { failureStreak: 0 } },
  ];

  it('两轮编排并产出决议 + 异议', async () => {
    const m = new ConferenceManager({ send: async (p) => `结论-${p.siteId}` });
    const r = await m.run({ topic: '修 bug', candidates: participants });
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.rounds.length).toBe(2);
    expect(r.ok && r.value.decision.buckets.length).toBe(2);
    expect(r.ok && r.value.decision.dissent.length).toBe(1);
  });

  it('首轮凑不齐人返回 err', async () => {
    const m = new ConferenceManager({ send: () => new Promise(() => {}), runner: new RoundRunner({ timeoutMs: 20 }) });
    const r = await m.run({ topic: 'x', candidates: participants });
    expect(r.ok).toBe(false);
  });

  it('轮次硬上限 2（传 5 也只跑 2 轮）', async () => {
    let calls = 0;
    const m = new ConferenceManager({ maxRounds: 5, send: async (p) => { calls += 1; return `x-${p.siteId}`; } });
    const r = await m.run({ topic: 'x', candidates: participants });
    expect(r.ok && r.value.rounds.length).toBeLessThanOrEqual(2);
    expect(calls).toBeLessThanOrEqual(4 * 2);
  });

  it('第二轮提示词注入了他人结论', () => {
    const p = buildPeerPrompt('原题', [{ role: 'reviewer', siteId: 's2', text: '我不同意' }]);
    expect(p).toContain('其他模型的结论');
    expect(p).toContain('我不同意');
    expect(p).toContain('逐条核对');
  });
});
