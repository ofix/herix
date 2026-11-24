/**
 * IPCGateway：主进程唯一对外入口。
 * 三条铁律：
 * ① 只有 `CHANNEL_LIST` 中的通道会被注册，防止 renderer 拿到任意 channel；
 * ② 所有入参先过 zod 校验，失败即 E_VALIDATION，绝不把非法数据送进 core；
 * ③ 统一 envelope `{ok,value|error,traceId,elapsedMs}`，异常一律转成 err 而不是让进程崩。
 * @module main/ipc/gateway
 */
import { CHANNEL_LIST } from '../../libs/contracts/channels.js';
import { ok, err } from '../../libs/utils/result.js';
import { ERROR_CODE } from '../../libs/utils/errors.js';

/**
 * @typedef {{ ok:true, value:any, traceId:string, elapsedMs:number }
 *   | { ok:false, error:{code:string,message:string,detail?:any}, traceId:string, elapsedMs:number }} Envelope
 */

export class Gateway {
  /**
   * @param {{ ipcMain: any, handlers: Record<string, {schema?:any, fn:Function}>, clock?: ()=>number, log?: (m:string)=>void }} deps
   */
  constructor(deps) {
    this.ipcMain = deps.ipcMain;
    this.handlers = deps.handlers;
    this.clock = deps.clock ?? Date.now;
    this.log = deps.log ?? (() => {});
    /** @type {string[]} */
    this.registered = [];
    this._seq = 0;
  }

  /** 注册全部通道；未知通道直接拒绝启动（配置写错要早暴露） */
  install() {
    for (const [channel, spec] of Object.entries(this.handlers)) {
      if (!CHANNEL_LIST.includes(channel)) {
        return err(ERROR_CODE.VALIDATION, `禁止注册非白名单通道：${channel}`);
      }
      this.ipcMain.handle(channel, (_e, payload) => this._dispatch(channel, spec, payload));
      this.registered.push(channel);
    }
    this.log(`[ipc] 已注册 ${this.registered.length} 个通道`);
    return ok({ channels: [...this.registered] });
  }

  /** @param {string} channel @param {any} spec @param {any} payload @returns {Promise<Envelope>} */
  async _dispatch(channel, spec, payload) {
    const t0 = this.clock();
    this._seq += 1;
    const traceId = `trc_ipc${String(this._seq).padStart(5, '0')}`;
    const finish = (body) => ({ ...body, traceId, elapsedMs: this.clock() - t0 });

    try {
      if (spec.schema) {
        const parsed = spec.schema.safeParse(payload ?? {});
        if (!parsed.success) {
          return finish({
            ok: false,
            error: {
              code: ERROR_CODE.VALIDATION,
              message: `入参校验失败：${channel}`,
              detail: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })),
            },
          });
        }
        payload = parsed.data;
      }
      const r = await spec.fn(payload, { traceId, channel });
      if (r && typeof r === 'object' && 'ok' in r) {
        return finish(r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error });
      }
      return finish({ ok: true, value: r });
    } catch (e) {
      const msg = /** @type {Error} */ (e)?.message ?? '未知异常';
      this.log(`[ipc] ${channel} 抛出异常：${msg}`);
      return finish({ ok: false, error: { code: ERROR_CODE.STORE_IO, message: `通道 ${channel} 异常：${msg}` } });
    }
  }

  /** 注销全部通道 @returns {Promise<void>} */
  async dispose() {
    for (const ch of this.registered) this.ipcMain.removeHandler?.(ch);
    this.registered = [];
  }
}

/** 供测试与手动调试：把 handler 直接当函数调（不经 ipcMain） @param {Gateway} gw @param {string} channel @param {any} payload */
export function invokeLocal(gw, channel, payload) {
  const spec = gw.handlers[channel];
  if (!spec) return Promise.resolve({ ok: false, error: { code: ERROR_CODE.VALIDATION, message: `通道不存在：${channel}` } });
  return /** @type {any} */ (gw)._dispatch(channel, spec, payload);
}
