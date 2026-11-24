/**
 * 对话状态：模型列表、当前固定模型、会话历史、浮层显隐（防抖）、发送。
 * 当前模型是"粘性"的：只有用户用 @ 主动切换才变，避免鼠标来回点。
 */
import { reactive, computed } from 'vue';
import { api } from '../api/index.js';
import { groupConversations, chatProgress } from '../utils/chat-group.js';
import { parseMentions } from '../utils/mention.js';

/**
 * @typedef {{ id:string, name:string, color:string, online:boolean }} Model
 * @typedef {{ id:string, title:string, modelId:string, createdAt:string, updatedAt?:string, messages:{role:string,text:string,ts:string}[] }} Conversation
 */
export const chat = reactive({
  models: /** @type {Model[]} */ ([]),
  currentModel: 'doubao',
  conversations: /** @type {Conversation[]} */ ([]),
  overlayVisible: false,
  expandedGroup: 0,
  scrollTop: 0,
  scrollHeight: 1,
  viewportHeight: 1,
  pendingSend: false,
  input: '',
});

export const groups = computed(() => groupConversations(chat.conversations, 10));

export const progress = computed(() => {
  const total = chat.conversations.length;
  const ratio = chat.scrollHeight > chat.viewportHeight ? chat.scrollTop / (chat.scrollHeight - chat.viewportHeight) : 0;
  const start = 1 + Math.round(ratio * Math.max(0, total - 1));
  return { ...chatProgress(start, total), ratio: Math.min(1, Math.max(0, ratio)) };
});

export const currentModelMeta = computed(() => chat.models.find((m) => m.id === chat.currentModel) ?? chat.models[0]);

export async function initChat() {
  const [models, conversations] = await Promise.all([api.models(), api.conversations()]);
  chat.models = models;
  chat.conversations = conversations;
  chat.currentModel = models.find((m) => m.online)?.id ?? models[0]?.id ?? '';
}

/** @models 选择：可多选，主模型取第一个；其余写入本轮引用 */
export function applyModelMentions(models) {
  if (!models.length) return;
  const first = chat.models.find((m) => m.name === models[0] || m.id === models[0]);
  if (first) chat.currentModel = first.id;
}

/** 防抖显隐：输入框聚焦才弹历史浮层，失焦延时收起（给点浮层内交互留窗口） */
/** @type {any} */ let showTimer = 0;
/** @type {any} */ let hideTimer = 0;
export function setOverlayFocus(focused, delay = 250) {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (focused) {
    showTimer = setTimeout(() => { chat.overlayVisible = true; }, delay);
  } else {
    hideTimer = setTimeout(() => { chat.overlayVisible = false; }, 320);
  }
}

export async function sendMessage(text, refs = []) {
  const prompt = String(text ?? '').trim();
  if (!prompt || chat.pendingSend) return null;
  chat.pendingSend = true;
  try {
    const item = await api.appendConversation({
      title: prompt.slice(0, 24),
      modelId: chat.currentModel,
      prompt,
      refs,
    });
    chat.conversations.unshift(item);
    chat.input = '';
    return item;
  } finally {
    chat.pendingSend = false;
  }
}

/** 由输入框调用：把解析结果同步给上层（提交时带上） */
export function collectRefs(text) {
  return parseMentions(text).refs;
}
