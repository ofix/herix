/**
 * 契约聚合出口。**零运行时依赖**：只 re-export 常量与本文件内的纯 typedef。
 * @module libs/contracts
 */

/** @typedef {import('./domain.js').TaskState} TaskState */
/** @typedef {import('./domain.js').SiteState} SiteState */
/** @typedef {import('./domain.js').ConferenceState} ConferenceState */
/** @typedef {import('./protocol.js').FrameType} FrameType */

export * from './domain.js';
export * from './protocol.js';
export * from './ids.js';
export * from './channels.js';

/** 契约版本。任何破坏性改名必须同时升这个值，并记入 doc/ADR。 */
export const CONTRACT_VERSION = '1';

/**
 * 调用上下文。所有跨层调用必须带 traceId。
 * @typedef {object} CallCtx
 * @property {string} traceId           trc_ 前缀 ID
 * @property {'user'|'engine'|'worker'|'checker'|'system'} actor 发起方
 * @property {AbortSignal} [signal]     协作式取消
 * @property {string} [idempotencyKey]  幂等键（写操作必填）
 */

/**
 * 任务转移事件。事件是唯一驱动状态机的方式。
 * @typedef {object} TaskEvent
 * @property {'submit'|'lease'|'reply.end'|'patch.ready'|'human.approve'|'human.reject'|'check.fail'|'check.pass'|'retry'|'cancel'|'fail'} type
 * @property {string} [taskId]
 * @property {string} [reason]
 * @property {object} [detail]
 */

/**
 * 单条状态转移规则（供 TaskMachine.transitions() 与 UI 共用）。
 * @typedef {object} Transition
 * @property {TaskState} from
 * @property {TaskEvent['type']} on
 * @property {TaskState} to
 * @property {string} [guard]  需要满足的前置条件描述
 */

/**
 * 状态切片名。StateStore.get/commit 参数的唯一取值域。
 * @typedef {'sites'|'projects'|'tasks'|'conferences'|'skills'} StateSlice
 */

/**
 * 领域事件（StateStore.commit 的唯一入参形态）。
 * @typedef {object} DomainEvent
 * @property {StateSlice} slice
 * @property {string} type
 * @property {string} at            ISO 时间串，由调用方注入（不得在 StateStore 内取时钟）
 * @property {object} payload
 * @property {string} traceId
 */

/**
 * SKILL 元数据（resources/skills/*.yaml 的解析结果）。
 * @typedef {object} SkillMeta
 * @property {string} id
 * @property {string} role          岗位角色，如 'implementer' | 'reviewer' | 'tester'
 * @property {string} title
 * @property {ReadonlyArray<string>} sites 允许的站点白名单（空 = 不限）
 * @property {boolean} needConference
 * @property {string} promptTemplate
 */

/**
 * 极简 Result 形状（contracts 零依赖，不能 import utils/result 的泛型实现）。
 * @typedef {{ ok: true, value: any } | { ok: false, error: { code: string, message: string, traceId?: string } }} ResultLike
 */

/**
 * 文件存储端口。由 infra/storage/file-store.js 实现；本层只声明形状，不依赖实现。
 * @typedef {object} FileStorePort
 * @property {(rel: string) => Promise<ResultLike>} readText          成功时 value 为 string|null
 * @property {(rel: string, text: string) => Promise<ResultLike>} writeTextAtomic
 * @property {(rel: string, line: string) => Promise<ResultLike>} appendLine
 * @property {(rel: string) => Promise<ResultLike>} list              成功时 value 为 string[]
 */

/**
 * 任务记录（state/tasks.json 的行形态）。
 * @typedef {object} TaskRecord
 * @property {string} id
 * @property {string} projectId
 * @property {TaskState} state
 * @property {string} skillId
 * @property {string} [siteId]
 * @property {number} retryCount
 * @property {string} createdAt
 * @property {string} updatedAt
 */
