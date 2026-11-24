/**
 * PromptComposer：把 SKILL 元数据、项目上下文、任务输入拼成单条网页提示词。
 * 约束：网页版输入框有长度上限（长文易被截断），因此按段预算裁剪，绝不整段丢弃关键约束。
 * @module main/core/model-io/prompt-composer
 */

const DEFAULT_BUDGET = { role: 1200, context: 6000, task: 4000, output: 2000 };

export class PromptComposer {
  /**
   * @param {{ budget?: Partial<typeof DEFAULT_BUDGET>, maxChars?: number }} [opts]
   */
  constructor(opts = {}) {
    this.budget = { ...DEFAULT_BUDGET, ...(opts.budget ?? {}) };
    this.maxChars = opts.maxChars ?? 14000;
  }

  /**
   * @param {{ skill?: any, task?: any, context?: { files?: {path:string,body:string}[], notes?: string[] }, outputSchema?: string }} input
   * @returns {{ text: string, sections: Record<string, number>, truncated: string[] }}
   */
  compose(input = {}) {
    const truncated = [];
    const skill = input.skill ?? {};
    const task = input.task ?? {};

    const role = this._clip(
      [
        `你现在扮演角色：${skill.title ?? skill.role ?? '工程师'}（${skill.role ?? 'engineer'}）。`,
        skill.promptTemplate ?? '',
        '严格遵守：只输出要求的格式，不要解释你在做什么。',
      ]
        .filter(Boolean)
        .join('\n'),
      this.budget.role,
      'role',
      truncated,
    );

    const ctxText = this._clip(this._renderContext(input.context), this.budget.context, 'context', truncated);
    const taskText = this._clip(String(task.prompt ?? ''), this.budget.task, 'task', truncated);
    const outText = this._clip(selfOutputSchema(input.outputSchema), this.budget.output, 'output', truncated);

    const text = [role, ctxText, `## 任务\n${taskText}`, outText].filter(Boolean).join('\n\n');
    return {
      text: text.length > this.maxChars ? text.slice(0, this.maxChars) : text,
      sections: { role: role.length, context: ctxText.length, task: taskText.length, output: outText.length, total: text.length },
      truncated,
    };
  }

  /** @param {any} ctx @returns {string} */
  _renderContext(ctx) {
    if (!ctx) return '';
    const parts = [];
    if (ctx.notes?.length) parts.push(`## 背景\n${ctx.notes.join('\n')}`);
    if (ctx.files?.length) {
      parts.push(
        '## 相关文件\n' +
          ctx.files
            .map((f) => `--- ${f.path} ---\n${f.body}`)
            .join('\n\n'),
      );
    }
    return parts.join('\n\n');
  }

  /**
   * @param {string} text
   * @param {number} max
   * @param {string} name
   * @param {string[]} truncated
   * @returns {string}
   */
  _clip(text, max, name, truncated) {
    if (text.length <= max) return text;
    truncated.push(name);
    const keep = Math.max(0, max - 24);
    return `${text.slice(0, keep)}\n...[已截断 ${text.length - keep} 字]`;
  }
}

/**
 * 统一输出协议：模型必须按此格式回，OutputExtractor 才能稳定解析。
 * @param {string} [schemaHint]
 * @returns {string}
 */
export function selfOutputSchema(schemaHint) {
  return [
    '## 输出格式（必须严格遵守）',
    '1. 先用一个 ```json 代码块给出结论与自评：{"summary":"...","confidence":0-1,"risks":["..."]}',
    '2. 如需改代码，再给一个 ```diff 代码块，必须为标准 unified diff（含 --- a/ 与 +++ b/ 头）。',
    '3. 除以上两个代码块外不要输出任何文字。',
    schemaHint ? `4. 结构化约束：${schemaHint}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
