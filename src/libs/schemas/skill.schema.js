/**
 * SKILL 元数据校验。resources/skills/*.yaml 的解析结果必须过这一层。
 * @module libs/schemas/skill
 */
import { z } from 'zod';

/** 岗位角色。新增角色必须同步更新此处与 UI 的角色筛选。 */
export const SkillRoleSchema = z.enum(['planner', 'implementer', 'reviewer', 'tester', 'doc-writer']);

/** 单个 SKILL。 */
export const SkillMetaSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,47}$/, 'skill id 只允许小写字母/数字/连字符'),
    role: SkillRoleSchema,
    title: z.string().min(1).max(60),
    sites: z.array(z.string().min(1).max(64)).default([]),
    needConference: z.boolean().default(false),
    promptTemplate: z.string().min(1).max(100_000),
    outputSchema: z.enum(['talk', 'patch', 'command', 'text']).default('patch'),
  })
  .strict();

/** SKILL 集合文件。 */
export const SkillBundleSchema = z.object({ version: z.literal('1'), skills: z.array(SkillMetaSchema) }).strict();
