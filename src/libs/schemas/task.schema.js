/**
 * 任务相关运行时校验：入参、事件、记录。
 * @module libs/schemas/task
 */
import { z } from 'zod';
import { TASK_STATE } from '../contracts/domain.js';
import { ID_PATTERN, IDEMPOTENCY_KEY_PATTERN } from '../contracts/ids.js';

/** 任务 ID：tsk_xxxxxxxx。 */
export const TaskIdSchema = z.string().regex(/^tsk_[0-9a-f]{8}$/);

/** 项目 ID：prj_xxxxxxxx。 */
export const ProjectIdSchema = z.string().regex(/^prj_[0-9a-f]{8}$/);

/** 状态枚举（与 TASK_STATE 一致性由单测守护）。 */
export const TaskStateSchema = z.enum([
  'queued',
  'running',
  'awaiting_human',
  'done',
  'failed_retryable',
  'failed_final',
  'cancelled',
]);

/** 事件类型。 */
export const TaskEventTypeSchema = z.enum([
  'submit',
  'lease',
  'reply.end',
  'patch.ready',
  'human.approve',
  'human.reject',
  'check.fail',
  'check.pass',
  'retry',
  'cancel',
  'fail',
]);

/** UI/IPC 提交任务的最小入参。 */
export const TaskInputSchema = z
  .object({
    projectId: ProjectIdSchema,
    skillId: z.string().min(1).max(64),
    prompt: z.string().min(1).max(200_000),
    priority: z.number().int().min(0).max(9).default(5),
    needConference: z.boolean().default(false),
    files: z.array(z.string().min(1)).max(200).default([]),
  })
  .strict();

/** 状态机事件。 */
export const TaskEventSchema = z
  .object({
    type: TaskEventTypeSchema,
    taskId: TaskIdSchema.optional(),
    reason: z.string().max(500).optional(),
    detail: z.record(z.unknown()).optional(),
  })
  .strict();

/** 持久化记录（state/tasks.json 行形态）。 */
export const TaskRecordSchema = z
  .object({
    id: TaskIdSchema,
    projectId: ProjectIdSchema,
    state: TaskStateSchema,
    skillId: z.string().min(1).max(64),
    siteId: z.string().max(64).optional(),
    retryCount: z.number().int().min(0).max(10),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

/** 幂等键（写操作必填）。 */
export const IdempotencyKeySchema = z.string().regex(IDEMPOTENCY_KEY_PATTERN);

/** ID 通用校验（用于非 task 场景的粗筛）。 */
export const AnyIdSchema = z.string().regex(ID_PATTERN);

export { TASK_STATE };
