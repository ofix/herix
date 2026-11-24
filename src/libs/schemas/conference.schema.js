/**
 * 会议相关校验：开会入参、单轮发言、投票记录。
 * @module libs/schemas/conference
 */
import { z } from 'zod';
import { TaskIdSchema } from './task.schema.js';

/** 会议硬上限：参会 ≤4、轮次 ≤2。 */
export const CONFERENCE_LIMITS = Object.freeze({ MAX_PARTICIPANTS: 4, MAX_ROUNDS: 2, TIMEOUT_MS: 120_000 });

/** 开会入参。 */
export const ConferenceOpenSchema = z
  .object({
    taskId: TaskIdSchema,
    topic: z.string().min(1).max(2_000),
    maxParticipants: z.number().int().min(2).max(CONFERENCE_LIMITS.MAX_PARTICIPANTS).default(3),
    maxRounds: z.number().int().min(1).max(CONFERENCE_LIMITS.MAX_ROUNDS).default(2),
  })
  .strict();

/** 单轮发言（模型必须回这个 JSON，OutputExtractor 用此 schema 校验）。 */
export const TalkSchema = z
  .object({
    stance: z.enum(['support', 'oppose', 'neutral']),
    summary: z.string().min(1).max(8_000),
    patch: z.string().max(400_000).optional(),
    risks: z.array(z.string().min(1).max(500)).max(20).default([]),
    vote: z.enum(['approve', 'reject', 'abstain']).optional(),
  })
  .strict();

/** 投票记录（含少数派意见，必须落 journal）。 */
export const VoteRecordSchema = z
  .object({
    conferenceId: z.string().regex(/^cnf_[0-9a-f]{8}$/),
    round: z.number().int().min(1).max(CONFERENCE_LIMITS.MAX_ROUNDS),
    votes: z
      .array(
        z
          .object({
            siteId: z.string().min(1).max(64),
            vote: z.enum(['approve', 'reject', 'abstain']),
            reason: z.string().max(500).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(CONFERENCE_LIMITS.MAX_PARTICIPANTS),
    decision: z.enum(['approve', 'reject', 'no_quorum']),
    at: z.string().datetime(),
  })
  .strict();
