<template>
  <div class="history-list scroll-thin" ref="listEl">
    <div
      v-for="g in groups"
      :key="g.index"
      :ref="el => (sectionRefs[g.index] = el)"
      class="section"
    >
      <div v-for="c in g.items" :key="c.id" class="session-block">
        <div v-for="m in c.messages" :key="m.ts + m.role" class="msg" :class="m.role">
          <div class="avatar">{{ m.role === "user" ? "你" : "AI" }}</div>
          <div class="bubble">
            <div class="meta">
              {{ m.role === "user" ? "你" : modelName(c.modelId) }} · {{ formatChatTime(m.ts) }}
            </div>
            <div class="text">{{ m.text }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
  import { ref, onMounted, onBeforeUnmount, watch } from "vue";
  import { chat } from "../stores/chat.js";
  import { formatChatTime } from "../utils/time.js";

  const props = defineProps(["groups", "activeId"]);
  const emit = defineEmits(["update:activeId"]);

  const listEl = ref(null);
  const sectionRefs = ref({});
  let observer = null;

  const modelName = id => chat.models.find(m => m.id === id)?.name ?? "AI";

  // 暴露给父组件调用的滚动方法
  function scrollTo(id) {
    const node = sectionRefs.value[id];
    if (node) node.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  defineExpose({ scrollTo });

  // 监听滚动，反向更新右侧索引的高亮状态
  onMounted(() => {
    observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = Number(entry.target.dataset.index);
            emit("update:activeId", id);
            break;
          }
        }
      },
      { root: listEl.value, rootMargin: "-15% 0px -70% 0px", threshold: 0 }
    );

    watch(
      () => props.groups,
      () => {
        Object.values(sectionRefs.value).forEach(el => {
          if (el) observer.observe(el);
        });
      },
      { immediate: true, deep: true }
    );
  });

  onBeforeUnmount(() => observer?.disconnect());
</script>

<style scoped>
  .history-list {
    flex: 1;
    overflow-y: auto;
    padding: 40px 24px 20px 32px; /* 顶部留出渐变呼吸空间 */
  }
  .section {
    margin-bottom: 32px;
  }
  .section-header {
    font-size: 13px;
    color: #8ab4ff;
    font-weight: 600;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid #33363a;
  }
  .msg {
    display: flex;
    gap: 12px;
    margin-bottom: 20px;
  }
  .msg.user {
    flex-direction: row-reverse;
  }
  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    flex: none;
    background: #3a3d41;
    color: #d4d4d4;
    font-size: 11px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .msg.user .avatar {
    background: #d7ba7d;
    color: #1e1f22;
  }
  .bubble {
    max-width: 80%;
  }
  .meta {
    font-size: 10.5px;
    color: #969696;
    margin-bottom: 4px;
  }
  .msg.user .meta {
    text-align: right;
  }
  .text {
    font-size: 13px;
    line-height: 1.6;
    color: #d4d4d4;
    white-space: pre-wrap;
    background: #2b2d30;
    padding: 10px 14px;
    border-radius: 8px;
  }
  .msg.user .text {
    background: #3794ff;
    color: #fff;
  }
</style>
