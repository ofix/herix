<template>
  <WaveNav :groups="groups" :active-id="activeId" :gap="14" @select="onSelect">
    <template #default="{ visible, anchorX, anchorY, group }">
      <WaveNavPopover
        :visible="visible && !!group"
        :anchor-x="anchorX"
        :anchor-y="anchorY"
        :width="260"
        :offset="20"
      >
        <div
          v-for="chat in group"
          :key="chat.index"
          class="chat-title"
          :title="chat?.title || '未命名对话组'"
        >
          {{ chat?.title || "未命名对话组" }}
        </div>
      </WaveNavPopover>
    </template>
  </WaveNav>
</template>

<script setup>
  import WaveNav from "./WaveNav.vue";
  import WaveNavPopover from "./ChatNavPopover.vue";
  // groups / activeId / onSelect 由父级提供
</script>

<style>
  .chat-title {
    font-size: 13px;
    color: #e6e6e6;
    line-height: 1.5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
