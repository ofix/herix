<template>
  <div class="chat-overlay" v-if="chat.overlayVisible">
    <!-- 使用 mask 实现顶部 15% 渐隐，且不阻挡底层代码点击 -->
    <div class="overlay-mask">
      <div class="overlay-body">
        <!-- 左侧：完整对话流 -->
        <ChatHistory
          ref="historyListRef"
          :groups="groups"
          :active-id="activeId"
          @update:active-id="activeId = $event"
        />
        <!-- 右侧：索引控件 -->
        <ChatMiniMenu :groups="groups" :active-id="activeId" @select="scrollToSection" />
      </div>
    </div>
  </div>
</template>

<script setup>
  import { ref } from "vue";
  import { chat, groups } from "../stores/chat.js";
  import ChatHistory from "./ChatHistory.vue";
  import ChatMiniMenu from "./ChatMiniMenu.vue";

  const historyListRef = ref(null);
  const activeId = ref(groups.value[0]?.index ?? 0);

  function scrollToSection(id) {
    historyListRef.value?.scrollTo(id);
    activeId.value = id;
  }
</script>

<style scoped>
  .chat-overlay {
    position: absolute;
    bottom: 0; /* 贴底覆盖 */
    left: 0;
    right: 0;
    height: 60%; /* 占据编辑器 60% 高度 */
    z-index: 50;
    pointer-events: none; /* 关键：让渐变区域不阻挡底层代码编辑器的点击 */
  }

  .overlay-mask {
    width: 100%;
    height: 100%;
    /* 核心：顶部 15% 渐隐，15% 之后完全不透明 */
    -webkit-mask-image: linear-gradient(
      to bottom,
      transparent 0%,
      rgba(0, 0, 0, 0.6) 10%,
      black 15%,
      black 100%
    );
    mask-image: linear-gradient(
      to bottom,
      transparent 0%,
      rgba(0, 0, 0, 0.6) 10%,
      black 15%,
      black 100%
    );
  }

  .overlay-body {
    width: 100%;
    height: 100%;
    display: flex;
    background: rgba(30, 31, 34, 0.92); /* 半透明背景，配合 mask 产生渐隐效果 */
    backdrop-filter: blur(8px);
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    pointer-events: auto; /* 恢复内容区域的鼠标交互 */
  }
</style>
