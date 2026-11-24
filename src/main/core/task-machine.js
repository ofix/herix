/**
 * TaskMachine：任务状态机的唯一权威。纯函数 —— 无 I/O、无时钟、无随机。
 * 非法转移一律返回 err(E_VALIDATION)，绝不抛异常。
 * @module main/core/task-machine
 */
import { ok, err } from '../../libs/utils/result.js';
import { ERROR_CODE } from '../../libs/utils/errors.js';
import { TASK_STATE, TASK_TERMINAL } from '../../libs/contracts/domain.js';

/** @template T @typedef {import('../../libs/utils/result.js').Result<T>} Result */
/** @typedef {import('../../libs/contracts/domain.js').TaskState} TaskState */
/** @typedef {import('../../libs/contracts/index.js').TaskEvent} TaskEvent */
/** @typedef {import('../../libs/contracts/index.js').Transition} Transition */
/** @typedef {import('../../libs/contracts/index.js').CallCtx} CallCtx */

const Q = TASK_STATE.QUEUED;
const R = TASK_STATE.RUNNING;
const H = TASK_STATE.AWAITING_HUMAN;
const D = TASK_STATE.DONE;
const FR = TASK_STATE.FAILED_RETRYABLE;
const FF = TASK_STATE.FAILED_FINAL;
const C = TASK_STATE.CANCELLED;

/** 全量转移表：UI 画图与单测遍历都读这一份。 */
const TABLE = /** @type {Transition[]} */ ([
  { from: Q, on: 'submit', to: Q, guard: '幂等：重复提交不改变状态' },
  { from: Q, on: 'lease', to: R },
  { from: R, on: 'reply.end', to: R, guard: '阶段推进，状态不变（等 patch 解析）' },
  { from: R, on: 'patch.ready', to: H, guard: 'patch 已生成，等人工审批' },
  { from: H, on: 'human.approve', to: R, guard: '批准后进入自动执行（apply+check）' },
  { from: H, on: 'human.reject', to: Q, guard: '驳回回队重做' },
  { from: R, on: 'check.pass', to: D },
  { from: R, on: 'check.fail', to: R, guard: '回灌修复，retryCount+1' },
  { from: FR, on: 'retry', to: Q },
  { from: Q, on: 'cancel', to: C },
  { from: R, on: 'cancel', to: C },
  { from: H, on: 'cancel', to: C },
  { from: Q, on: 'fail', to: FF, guard: '不可重试的失败' },
  { from: R, on: 'fail', to: FR, guard: '默认可重试，超限后由调用方转 FF' },
  { from: FR, on: 'fail', to: FF },
]);

export class TaskMachine {
  /** @returns {TaskState} */
  static initial() {
    return Q;
  }

  /** @returns {ReadonlyArray<Transition>} */
  static transitions() {
    return Object.freeze(TABLE.slice());
  }

  /**
   * @param {TaskState} state
   * @returns {boolean}
   */
  static isTerminal(state) {
    return TASK_TERMINAL.includes(state);
  }

  /**
   * @param {CallCtx} ctx
   * @param {TaskState} state
   * @param {TaskEvent} event
   * @returns {Result<TaskState>} 下一状态；非法转移返回 err
   */
  static apply(ctx, state, event) {
    if (!Object.values(TASK_STATE).includes(state)) {
      return err(ERROR_CODE.VALIDATION, `未知状态: ${state}`, { traceId: ctx?.traceId });
    }
    if (!event || typeof event.type !== 'string') {
      return err(ERROR_CODE.VALIDATION, '事件缺失 type', { traceId: ctx?.traceId });
    }
    if (TaskMachine.isTerminal(state)) {
      return err(ERROR_CODE.VALIDATION, `终态 ${state} 不可再转移（on=${event.type}）`, { traceId: ctx?.traceId });
    }
    const hit = TABLE.find((t) => t.from === state && t.on === event.type);
    if (!hit) {
      return err(ERROR_CODE.VALIDATION, `非法转移: ${state} + ${event.type}`, {
        traceId: ctx?.traceId,
        detail: { from: state, on: event.type },
      });
    }
    return ok(hit.to);
  }

  /**
   * 校验整张表的自洽性（供单测与启动自检）。
   * @returns {Result<{ transitions: number }>}
   */
  static auditTable() {
    const seen = new Set();
    for (const t of TABLE) {
      const key = `${t.from}|${t.on}`;
      if (seen.has(key)) return err(ERROR_CODE.VALIDATION, `转移表重复: ${key}`);
      seen.add(key);
      if (!Object.values(TASK_STATE).includes(t.from) || !Object.values(TASK_STATE).includes(t.to)) {
        return err(ERROR_CODE.VALIDATION, `转移表含未知状态: ${key}`);
      }
      if (TaskMachine.isTerminal(t.from)) return err(ERROR_CODE.VALIDATION, `终态存在出边: ${key}`);
    }
    return ok({ transitions: TABLE.length });
  }
}
