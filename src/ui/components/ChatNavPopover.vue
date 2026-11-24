<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="popoverRef"
      class="wave-nav-popover"
      :style="style"
      @mouseenter="onEnter"
      @mouseleave="onLeave"
    >
      <slot />
    </div>
  </Teleport>
</template>

<script setup>
  import { computed, ref } from "vue";

  const props = defineProps({
    visible: { type: Boolean, default: false },
    /** 锚点屏幕坐标（视口坐标） */
    anchorX: { type: Number, default: 0 },
    anchorY: { type: Number, default: 0 },
    /** popover 自身宽度，用于左右翻转判断 */
    width: { type: Number, default: 260 },
    /** 与锚点的间距 */
    offset: { type: Number, default: 48 },
    /** 视口边缘安全距离 */
    edge: { type: Number, default: 8 },
  });

  const emit = defineEmits(["enter", "leave"]);

  const popoverRef = ref(null);

  /** 左侧空间够就往左展开，否则往右 */
  const placement = computed(() => {
    const leftSpace = props.anchorX - props.offset - props.width;
    return leftSpace >= props.edge ? "left" : "right";
  });

  const style = computed(() => {
    const isLeft = placement.value === "left";
    const x = isLeft ? props.anchorX - props.offset : props.anchorX + props.offset;
    return {
      position: "fixed",
      top: `${props.anchorY}px`,
      left: `${x}px`,
      width: `${props.width}px`,
      transform: isLeft ? "translate(-100%, -50%)" : "translate(0, -50%)",
    };
  });

  function onEnter() {
    emit("enter");
  }
  function onLeave() {
    emit("leave");
  }

  defineExpose({ popoverRef });
</script>

<style>
  .wave-nav-popover {
    z-index: 3000;
    background: #2b2d30;
    border: 1px solid #3e4044;
    border-radius: 6px;
    padding: 8px 14px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    pointer-events: auto;
    box-sizing: border-box;
  }
</style>
