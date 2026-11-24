# HERIX API Surface（生成物，勿手改）

> 由 `scripts/gen-api-surface.mjs` 生成。文件 69 个，已实现 69 个，骨架 0 个。
> 进度台账：B0:done · B1:done · B2:done · B3:done · B4:done · B5:done · B6:done · B7:done · B8a:done · B8b:done · B9a:done · B9b:done

## libs/contracts

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `libs/contracts/channels.js` | const **CHANNEL** | — | impl |
| `libs/contracts/channels.js` | const **CHANNEL_LIST** | — | impl |
| `libs/contracts/domain.js` | const **TASK_STATE** | — | impl |
| `libs/contracts/domain.js` | const **TASK_TERMINAL** | — | impl |
| `libs/contracts/domain.js` | const **SITE_STATE** | — | impl |
| `libs/contracts/domain.js` | const **CONFERENCE_STATE** | — | impl |
| `libs/contracts/domain.js` | const **RISK_STATE** | — | impl |
| `libs/contracts/domain.js` | const **VOTE** | — | impl |
| `libs/contracts/domain.js` | const **PROJECT_STATE** | — | impl |
| `libs/contracts/ids.js` | const **ID_PREFIX** | — | impl |
| `libs/contracts/ids.js` | const **ID_PATTERN** | — | impl |
| `libs/contracts/ids.js` | function **isId** | — | impl |
| `libs/contracts/ids.js` | const **IDEMPOTENCY_KEY_PATTERN** | — | impl |
| `libs/contracts/index.js` | const **CONTRACT_VERSION** | — | impl |
| `libs/contracts/protocol.js` | const **FRAME_TYPE** | — | impl |
| `libs/contracts/protocol.js` | const **HEARTBEAT** | — | impl |
| `libs/contracts/protocol.js` | const **FRAME_MAX_BYTES** | — | impl |
| `libs/contracts/protocol.js` | const **STDOUT_FRAME_TYPES** | — | impl |

## libs/schemas

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `libs/schemas/codec.js` | function **encodeFrame** | — | impl |
| `libs/schemas/codec.js` | function **decodeLine** | — | impl |
| `libs/schemas/codec.js` | function **decodeChunk** | — | impl |
| `libs/schemas/conference.schema.js` | const **CONFERENCE_LIMITS** | — | impl |
| `libs/schemas/conference.schema.js` | const **ConferenceOpenSchema** | — | impl |
| `libs/schemas/conference.schema.js` | const **TalkSchema** | — | impl |
| `libs/schemas/conference.schema.js` | const **VoteRecordSchema** | — | impl |
| `libs/schemas/frame.schema.js` | const **FrameTypeSchema** | — | impl |
| `libs/schemas/frame.schema.js` | const **TraceIdSchema** | — | impl |
| `libs/schemas/frame.schema.js` | const **FrameSchema** | — | impl |
| `libs/schemas/frame.schema.js` | const **HeartbeatSchema** | — | impl |
| `libs/schemas/frame.schema.js` | const **FRAME_LIMIT** | — | impl |
| `libs/schemas/index.js` | function **parse** | — | impl |
| `libs/schemas/index.js` | function **parseAll** | — | impl |
| `libs/schemas/site.schema.js` | const **SelectorSetSchema** | — | impl |
| `libs/schemas/site.schema.js` | const **ThrottleSchema** | — | impl |
| `libs/schemas/site.schema.js` | const **SiteConfigSchema** | — | impl |
| `libs/schemas/site.schema.js` | const **SiteStateSchema** | — | impl |
| `libs/schemas/site.schema.js` | const **SiteRecordSchema** | — | impl |
| `libs/schemas/site.schema.js` | const **SiteBundleSchema** | — | impl |
| `libs/schemas/skill.schema.js` | const **SkillRoleSchema** | — | impl |
| `libs/schemas/skill.schema.js` | const **SkillMetaSchema** | — | impl |
| `libs/schemas/skill.schema.js` | const **SkillBundleSchema** | — | impl |
| `libs/schemas/task.schema.js` | const **TaskIdSchema** | — | impl |
| `libs/schemas/task.schema.js` | const **ProjectIdSchema** | — | impl |
| `libs/schemas/task.schema.js` | const **TaskStateSchema** | — | impl |
| `libs/schemas/task.schema.js` | const **TaskEventTypeSchema** | — | impl |
| `libs/schemas/task.schema.js` | const **TaskInputSchema** | — | impl |
| `libs/schemas/task.schema.js` | const **TaskEventSchema** | — | impl |
| `libs/schemas/task.schema.js` | const **TaskRecordSchema** | — | impl |
| `libs/schemas/task.schema.js` | const **IdempotencyKeySchema** | — | impl |
| `libs/schemas/task.schema.js` | const **AnyIdSchema** | — | impl |

## libs/utils

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `libs/utils/errors.js` | const **ERROR_CODE** | — | impl |
| `libs/utils/errors.js` | function **notImplemented** | — | impl |
| `libs/utils/errors.js` | function **isNotImplemented** | — | impl |
| `libs/utils/frame-io.js` | class **FrameIO** | attach()<br>_onData(chunk)<br>_handleLine(line)<br>drain()<br>send(frame)<br>close() | impl |
| `libs/utils/frame-io.js` | function **logToStderr** | — | impl |
| `libs/utils/result.js` | function **ok** | — | impl |
| `libs/utils/result.js` | function **err** | — | impl |
| `libs/utils/result.js` | function **isOk** | — | impl |
| `libs/utils/result.js` | function **unwrap** | — | impl |
| `libs/utils/time.js` | class **AbortError** | — | impl |
| `libs/utils/time.js` | const **systemClock** | — | impl |
| `libs/utils/time.js` | function **nowIso** | — | impl |
| `libs/utils/time.js` | function **isIsoTimestamp** | — | impl |
| `libs/utils/time.js` | function **sleep** | — | impl |

## main/bridges

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/bridges/playwright-bridge.js` | class **PlaywrightBridge** | _onFrame(f)<br>_settle(traceId, result)<br>_rejectAll(code, message)<br>request(type, payload, opts = {})<br>hello()<br>openSite(site, opts = {})<br>closeSite(siteId)<br>login(siteId, opts = {})<br>sendTask({ siteId, prompt, onChunk, timeoutMs }) | impl |

## main/checks/providers

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/checks/providers/_shared.js` | function **diag** | — | impl |
| `main/checks/providers/_shared.js` | function **num** | — | impl |
| `main/checks/providers/_shared.js` | function **parseTsc** | — | impl |
| `main/checks/providers/_shared.js` | function **parseEslint** | — | impl |
| `main/checks/providers/_shared.js` | function **parseRuff** | — | impl |
| `main/checks/providers/_shared.js` | function **parsePyright** | — | impl |
| `main/checks/providers/_shared.js` | function **parseGo** | — | impl |
| `main/checks/providers/_shared.js` | function **parseCargo** | — | impl |
| `main/checks/providers/_shared.js` | function **parseClangTidy** | — | impl |
| `main/checks/providers/_shared.js` | function **fallback** | — | impl |
| `main/checks/providers/_shared.js` | function **languageOf** | — | impl |
| `main/checks/providers/index.js` | const **ALL_PROVIDERS** | — | impl |

## main/checks/providers/cpp

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/checks/providers/cpp/clang-tidy.js` | const **clangTidyProvider** | — | impl |

## main/checks/providers/go

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/checks/providers/go/govet.js` | const **govetProvider** | — | impl |
| `main/checks/providers/go/staticcheck.js` | const **staticcheckProvider** | — | impl |

## main/checks/providers/js

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/checks/providers/js/eslint.js` | const **eslintProvider** | — | impl |
| `main/checks/providers/js/tsc.js` | const **tscProvider** | — | impl |

## main/checks/providers/python

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/checks/providers/python/pyright.js` | const **pyrightProvider** | — | impl |
| `main/checks/providers/python/ruff.js` | const **ruffProvider** | — | impl |

## main/checks/providers/rust

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/checks/providers/rust/clippy.js` | const **clippyProvider** | — | impl |

## main/checks

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/checks/registry.js` | class **CheckRegistry** | register(provider)<br>get(id)<br>all()<br>listByLanguage(language, id)<br>detect(files)<br>select({ providerId, files }) | impl |
| `main/checks/service.js` | class **CheckService** | run(req)<br>toFeedback(diagnostics, opts = {}) | impl |

## main/core/conference

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/core/conference/manager.js` | class **ConferenceManager** | run({ topic, candidates, requiredRoles, ctx })<br>_agree(round) | impl |
| `main/core/conference/manager.js` | function **buildPeerPrompt** | — | impl |
| `main/core/conference/participant-picker.js` | const **MAX_PARTICIPANTS** | — | impl |
| `main/core/conference/participant-picker.js` | class **ParticipantPicker** | pick({ candidates, requiredRoles })<br>refill({ picked, failedSiteIds, candidates }) | impl |
| `main/core/conference/round-runner.js` | class **RoundRunner** | — | impl |
| `main/core/conference/round-runner.js` | function **withTimeout** | — | impl |
| `main/core/conference/vote-tally.js` | function **fingerprint** | — | impl |
| `main/core/conference/vote-tally.js` | class **VoteTally** | tally(votes) | impl |

## main/core

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/core/engine.js` | class **Engine** | submitTask(ctx, input)<br>applyEvent(ctx, taskId, event)<br>approveTask(ctx, { taskId, decision, reason, scope = 'single' })<br>getSnapshot() | impl |
| `main/core/scheduler.js` | class **Scheduler** | shouldCircuitBreak(siteId, h)<br>selectSite({ skillId, candidates, allowedSites = [] })<br>rankSites({ skillId, candidates, allowedSites = [] }) | impl |
| `main/core/site-queue.js` | class **SiteQueue** | enqueue(siteId, item)<br>isBusy(siteId)<br>lease(siteId)<br>release(siteId)<br>reserve(siteId, confId)<br>reserveAll(siteIds, confId)<br>releaseReservation(siteId)<br>size(siteId)<br>snapshot() | impl |
| `main/core/task-machine.js` | class **TaskMachine** | initial()<br>transitions()<br>isTerminal(state)<br>apply(ctx, state, event)<br>auditTable() | impl |

## main/core/model-io

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/core/model-io/output-extractor.js` | class **OutputExtractor** | extract(raw)<br>extractStrict(raw, req = {}) | impl |
| `main/core/model-io/output-extractor.js` | function **tryJson** | — | impl |
| `main/core/model-io/prompt-composer.js` | class **PromptComposer** | compose(input = {})<br>_renderContext(ctx)<br>_clip(text, max, name, truncated) | impl |
| `main/core/model-io/prompt-composer.js` | function **selfOutputSchema** | — | impl |
| `main/core/model-io/response-repair.js` | class **ResponseRepair** | repairOnce(raw, req = {})<br>fetchAndRepair({ fetch, req = {} })<br>snapshot() | impl |

## main/core/registry

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/core/registry/config-resolver.js` | class **ConfigResolver** | load(kind, ctx)<br>watch(onChange, ctx)<br>emitChange(kind, rejected = []) | impl |
| `main/core/registry/skill-registry.js` | class **SkillRegistry** | loadAll(items)<br>get(skillId)<br>listByRole(role)<br>list()<br>allowsSite(skillId, siteId) | impl |

## main/core/runtime

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/core/runtime/worker-guard.js` | class **WorkerGuard** | start()<br>_spawn()<br>_startHeartbeat()<br>_stopHeartbeat()<br>_onExit(code, signal)<br>_restart()<br>send(frame)<br>stop()<br>stats() | impl |

## main/core/state/repositories

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/core/state/repositories/task.js` | const **TASKS_FILE** | — | impl |
| `main/core/state/repositories/task.js` | class **TaskRepository** | load()<br>save(records)<br>apply(slice, event) | impl |

## main/core/state

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/core/state/state-store.js` | const **SLICES** | — | impl |
| `main/core/state/state-store.js` | class **StateStore** | hydrate(ctx)<br>get(slice)<br>_withLock(slice, fn)<br>commit(ctx, event)<br>subscribe(slice, fn)<br>_notify(slice) | impl |

## main/git

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/git/changeset-builder.js` | class **ChangesetBuilder** | build(input)<br>finalize({ id, status, result })<br>read(id) | impl |
| `main/git/patch-pipeline.js` | class **PatchPipeline** | parsePaths(diff)<br>validate({ worktreePath, diff })<br>apply({ worktreePath, diff })<br>revert({ worktreePath, diff }) | impl |
| `main/git/patch-pipeline.js` | function **runGitWithStdin** | — | impl |
| `main/git/project-manager.js` | class **ProjectManager** | open({ projectId, repoPath, baseRef = 'HEAD' })<br>get(projectId)<br>close(projectId, opts = {})<br>list()<br>exec(projectId, args) | impl |
| `main/git/project-manager.js` | function **runGit** | — | impl |
| `main/git/project-manager.js` | function **isInside** | — | impl |

## main/infra/observability

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/infra/observability/audit.js` | class **AuditLogger** | record(entry)<br>command({ traceId, ticketId, approver, commandHash, phase }) | impl |
| `main/infra/observability/audit.js` | const **noopAudit** | — | impl |
| `main/infra/observability/trace.js` | function **newTrace** | — | impl |
| `main/infra/observability/trace.js` | function **childTrace** | — | impl |
| `main/infra/observability/trace.js` | function **traceFields** | — | impl |

## main/infra/security

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/infra/security/redaction.js` | const **SENSITIVE_KEYS** | — | impl |
| `main/infra/security/redaction.js` | const **MASK** | — | impl |
| `main/infra/security/redaction.js` | function **redact** | — | impl |
| `main/infra/security/redaction.js` | function **isSensitiveKey** | — | impl |
| `main/infra/security/redaction.js` | function **redactText** | — | impl |

## main/infra/storage

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/infra/storage/atomic.js` | const **TMP_MARK** | — | impl |
| `main/infra/storage/file-store.js` | class **FileStore** | abs(rel)<br>_withLock(key, fn)<br>readText(rel)<br>writeTextAtomic(rel, text)<br>appendLine(rel, line)<br>list(rel) | impl |
| `main/infra/storage/journal.js` | const **JOURNAL_NAMES** | — | impl |
| `main/infra/storage/journal.js` | class **Journal** | pathOf(name)<br>append(name, record)<br>read(rel) | impl |

## main/ipc

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/ipc/gateway.js` | class **Gateway** | install()<br>_dispatch(channel, spec, payload)<br>dispose() | impl |
| `main/ipc/gateway.js` | function **invokeLocal** | — | impl |

## main/sandbox

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `main/sandbox/command-policy.js` | class **CommandPolicy** | allowed(cmd, args = [])<br>issue({ cmd, args, cwd, worktreeHash, approver, scope = 'single', providerId })<br>authorize({ ticketId, cmd, args, cwd, worktreeHash })<br>revoke(ticketId)<br>pending()<br>_gc()<br>_log(action, cmd, approver, reason) | impl |
| `main/sandbox/command-policy.js` | function **digestOf** | — | impl |
| `main/sandbox/command-policy.js` | function **defaultAllowlist** | — | impl |
| `main/sandbox/command-runner.js` | class **CommandRunner** | run(req) | impl |

## renderer

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `renderer/src/api/index.js` | function **createApi** | — | impl |
| `renderer/src/api/index.js` | const **api** | — | impl |
| `renderer/src/components/diagnostic-list.js` | function **formatDiagnostic** | — | impl |
| `renderer/src/components/diagnostic-list.js` | function **renderDiagnostics** | — | impl |
| `renderer/src/composables/useTasks.js` | function **createTaskStore** | — | impl |
| `renderer/src/composables/useTasks.js` | function **groupByState** | — | impl |
| `renderer/src/router/route.js` | const **ROUTES** | — | impl |
| `renderer/src/router/route.js` | function **parseHash** | — | impl |
| `renderer/src/router/route.js` | function **toHash** | — | impl |
| `renderer/src/router/route.js` | function **watchRoute** | — | impl |
| `renderer/src/stores/app-store.js` | function **createAppStore** | — | impl |
| `renderer/src/views/task-board.js` | function **mountTaskBoard** | — | impl |

## workers/playwright-worker

| 文件 | 导出 | 成员（签名） | 状态 |
|---|---|---|---|
| `workers/playwright-worker/element-parser.js` | function **classify** | — | impl |
| `workers/playwright-worker/element-parser.js` | function **generate** | — | impl |
| `workers/playwright-worker/element-parser.js` | function **parse** | — | impl |
| `workers/playwright-worker/element-parser.js` | function **healingChain** | — | impl |
| `workers/playwright-worker/element-parser.js` | function **tokenize** | — | impl |
| `workers/playwright-worker/login-flow.js` | class **LoginFlow** | detect()<br>verifyReuse() | impl |
| `workers/playwright-worker/main.js` | const **__internals** | — | impl |
| `workers/playwright-worker/reply-assembler.js` | class **ReplyAssembler** | start(now)<br>feed(chunk, now)<br>tick(now)<br>signalDone()<br>snapshot() | impl |
| `workers/playwright-worker/reply-assembler.js` | function **mergeSnapshot** | — | impl |
| `workers/playwright-worker/reply-assembler.js` | function **fnv1a** | — | impl |
| `workers/playwright-worker/shot-stream.js` | class **ShotStream** | start()<br>_tick()<br>stop()<br>stats() | impl |
| `workers/playwright-worker/shot-stream.js` | function **assertShotBudget** | — | impl |
| `workers/playwright-worker/site-session.js` | function **domProbe** | — | impl |
| `workers/playwright-worker/site-session.js` | class **SiteSession** | open(opts = {})<br>snapshotDom()<br>locateInput()<br>sendPrompt(text)<br>readReply({ traceId, onChunk, signal, opts = {} })<br>captureState()<br>close() | impl |
