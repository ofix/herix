/**
 * B1b 契约测试：schema 必须拦住坏数据，且与枚举常量严格一致。
 */
import { describe, it, expect } from 'vitest';
import {
  FrameSchema,
  FrameTypeSchema,
  TaskInputSchema,
  TaskRecordSchema,
  SiteConfigSchema,
  SkillMetaSchema,
  TalkSchema,
  ConferenceOpenSchema,
  parse,
  parseAll,
  CONFERENCE_LIMITS,
} from '../../../src/libs/schemas/index.js';
import { FRAME_TYPE, TASK_STATE, SITE_STATE } from '../../../src/libs/contracts/index.js';

describe('常量与 schema 一致性', () => {
  it('FRAME_TYPE 与 FrameTypeSchema 完全对齐', () => {
    const fromSchema = FrameTypeSchema.options.slice().sort();
    const fromConst = Object.values(FRAME_TYPE).slice().sort();
    expect(fromSchema).toEqual(fromConst);
  });

  it('TASK_STATE 全部被 TaskRecordSchema 接受', async () => {
    const { TaskStateSchema } = await import('../../../src/libs/schemas/task.schema.js');
    expect(TaskStateSchema.options.slice().sort()).toEqual(Object.values(TASK_STATE).slice().sort());
  });

  it('SITE_STATE 与 site schema 对齐', async () => {
    const { SiteStateSchema } = await import('../../../src/libs/schemas/site.schema.js');
    expect(SiteStateSchema.options.slice().sort()).toEqual(Object.values(SITE_STATE).slice().sort());
  });
});

describe('FrameSchema', () => {
  const good = { type: 'ping', traceId: 'trc_00ff11ee', seq: 1, ts: 1730000000000 };

  it('接受合法帧', () => {
    expect(FrameSchema.safeParse(good).success).toBe(true);
  });

  it('拒绝未知帧类型（协议漂移）', () => {
    expect(FrameSchema.safeParse({ ...good, type: 'task.resume' }).success).toBe(false);
  });

  it('拒绝非法 traceId', () => {
    expect(FrameSchema.safeParse({ ...good, traceId: 'trace-1' }).success).toBe(false);
  });

  it('拒绝负 seq 与多余字段', () => {
    expect(FrameSchema.safeParse({ ...good, seq: -1 }).success).toBe(false);
    expect(FrameSchema.safeParse({ ...good, extra: true }).success).toBe(false);
  });
});

describe('TaskInputSchema', () => {
  it('拒绝非法 projectId 与空 prompt', () => {
    const base = { projectId: 'prj_0011aabb', skillId: 'impl-1', prompt: 'x' };
    expect(TaskInputSchema.safeParse(base).success).toBe(true);
    expect(TaskInputSchema.safeParse({ ...base, projectId: 'project-1' }).success).toBe(false);
    expect(TaskInputSchema.safeParse({ ...base, prompt: '' }).success).toBe(false);
  });

  it('默认值生效：priority=5, needConference=false', () => {
    const parsed = TaskInputSchema.parse({ projectId: 'prj_0011aabb', skillId: 'impl-1', prompt: 'x' });
    expect(parsed.priority).toBe(5);
    expect(parsed.needConference).toBe(false);
  });
});

describe('TaskRecordSchema', () => {
  it('拒绝 non-terminal 之外拼错的 state', () => {
    const rec = {
      id: 'tsk_0011aabb',
      projectId: 'prj_0011aabb',
      state: 'queued',
      skillId: 'impl-1',
      retryCount: 0,
      createdAt: '2026-11-21T10:00:00.000Z',
      updatedAt: '2026-11-21T10:00:00.000Z',
    };
    expect(TaskRecordSchema.safeParse(rec).success).toBe(true);
    expect(TaskRecordSchema.safeParse({ ...rec, state: 'pending' }).success).toBe(false);
    expect(TaskRecordSchema.safeParse({ ...rec, retryCount: 99 }).success).toBe(false);
  });
});

describe('SiteConfigSchema', () => {
  const site = {
    id: 'doubao-web',
    name: '豆包网页版',
    url: 'https://www.doubao.com/chat',
    selectors: { input: 'textarea', send: 'button[type=submit]', reply: '[data-role=assistant]' },
    throttle: { minIntervalMs: 3000 },
  };

  it('接受最小可用配置，jitter 默认 0', () => {
    const r = SiteConfigSchema.safeParse(site);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.throttle.jitterMs).toBe(0);
  });

  it('拒绝缺失 selectors 与过小的限流间隔', () => {
    const { selectors: _unused, ...noSelectors } = site;
    expect(SiteConfigSchema.safeParse(noSelectors).success).toBe(false);
    expect(SiteConfigSchema.safeParse({ ...site, throttle: { minIntervalMs: 100 } }).success).toBe(false);
  });
});

describe('SkillMetaSchema', () => {
  it('拒绝未知角色', () => {
    const skill = { id: 'impl-1', role: 'implementer', title: '实现者', promptTemplate: 'do it' };
    expect(SkillMetaSchema.safeParse(skill).success).toBe(true);
    expect(SkillMetaSchema.safeParse({ ...skill, role: 'god' }).success).toBe(false);
  });
});

describe('TalkSchema / ConferenceOpenSchema', () => {
  it('会议轮次不得超过硬上限', () => {
    expect(
      ConferenceOpenSchema.safeParse({ taskId: 'tsk_0011aabb', topic: 'x', maxRounds: CONFERENCE_LIMITS.MAX_ROUNDS })
        .success,
    ).toBe(true);
    expect(ConferenceOpenSchema.safeParse({ taskId: 'tsk_0011aabb', topic: 'x', maxRounds: 3 }).success).toBe(false);
  });

  it('发言必须带 stance 与 summary', () => {
    expect(TalkSchema.safeParse({ stance: 'support', summary: 'ok' }).success).toBe(true);
    expect(TalkSchema.safeParse({ summary: 'ok' }).success).toBe(false);
    expect(TalkSchema.safeParse({ stance: 'maybe', summary: 'ok' }).success).toBe(false);
  });
});

describe('parse / parseAll 不抛异常', () => {
  it('坏数据返回 err(E_VALIDATION)', () => {
    const r = parse(TaskInputSchema, { projectId: 'bad' }, { traceId: 'trc_00ff11ee', where: 'ipc.task.submit' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('E_VALIDATION');
      expect(r.error.traceId).toBe('trc_00ff11ee');
      expect(r.error.message).toContain('ipc.task.submit');
    }
  });

  it('parseAll 在首个失败项短路并标注下标', () => {
    const r = parseAll(TalkSchema, [{ stance: 'support', summary: 'a' }, { stance: 'oppose' }], { where: 'talks' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('talks[1]');
  });
});
