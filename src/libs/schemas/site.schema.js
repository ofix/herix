/**
 * 站点配置与状态校验。resources/sites/*.yaml 与 userData 覆盖层共用同一 schema。
 * @module libs/schemas/site
 */
import { z } from 'zod';

/** 定位器集合：站点适配的全部入口都在这五个键上。 */
export const SelectorSetSchema = z
  .object({
    input: z.string().min(1),
    send: z.string().min(1),
    reply: z.string().min(1),
    streaming: z.string().optional(),
    stop: z.string().optional(),
    loginForm: z.string().optional(),
  })
  .strict();

/** 限流参数。最小间隔不得低于 1s，避免自造风控特征。 */
export const ThrottleSchema = z
  .object({
    minIntervalMs: z.number().int().min(1000).max(600_000),
    jitterMs: z.number().int().min(0).max(60_000).default(0),
  })
  .strict();

/** 站点配置（一个站点一份 yaml）。 */
export const SiteConfigSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{2,31}$/, '站点 id 只允许小写字母/数字/连字符'),
    name: z.string().min(1).max(40),
    url: z.string().url(),
    loginUrl: z.string().url().optional(),
    selectors: SelectorSetSchema,
    throttle: ThrottleSchema,
    skills: z.array(z.string().min(1)).default([]),
    enabled: z.boolean().default(true),
  })
  .strict();

/** 站点运行时状态。 */
export const SiteStateSchema = z.enum(['available', 'busy', 'unavailable', 'logged_out', 'cooling']);

/** 站点记录（state/sites.json 行形态）。 */
export const SiteRecordSchema = z
  .object({
    id: SiteConfigSchema.shape.id,
    state: SiteStateSchema,
    lastError: z.string().max(500).optional(),
    cooldownUntil: z.string().datetime().optional(),
    loggedInAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime(),
  })
  .strict();

/** 站点 yaml 集合（ConfigResolver 的产物）。 */
export const SiteBundleSchema = z.object({ version: z.literal('1'), sites: z.array(SiteConfigSchema) }).strict();
