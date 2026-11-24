<template>
  <WaveNav
    :count="groups.length"
    :active-id="activeId"
    :gap="14"
    position="right"
    @select="onSelect"
  >
    <template #default="{ visible, index, anchorX, anchorY, placement, onEnter, onLeave }">
      <WaveNavPopover
        :visible="visible && index >= 0 && groups[index]?.items?.length > 0"
        :anchor-x="anchorX"
        :anchor-y="anchorY"
        :placement="placement"
        :width="260"
        :offset="10"
        @enter="onEnter"
        @leave="onLeave"
      >
        <div
          v-for="chat in groups[index]?.items || []"
          :key="chat.index"
          class="chat-title"
          :title="chat.title || '未命名对话组'"
          @click="onSelect(chat.index)"
        >
          {{ chat.title || "未命名对话组" }}
        </div>
      </WaveNavPopover>
    </template>
  </WaveNav>
</template>

<script setup>
  import WaveNav from "./WaveNav.vue";
  import WaveNavPopover from "./WaveNavPopover.vue";

  const props = defineProps({
    groups: { type: Array, required: true },
    activeId: { type: Number, default: -1 },
  });
  const emit = defineEmits(["select"]);

  function onSelect(globalIndex) {
    emit("select", globalIndex);
  }
</script>

<style>
  .chat-title {
    font-size: 13px;
    color: #e6e6e6;
    line-height: 1.5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .chat-title:hover {
    color: #fff;
  }
</style>
