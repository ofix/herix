<template>
  <Teleport to="body">
    <div
      v-if="visible"
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
  import { computed } from "vue";

  const props = defineProps({
    visible: { type: Boolean, default: false },
    anchorX: { type: Number, default: 0 },
    anchorY: { type: Number, default: 0 },
    /** popover 相对锚点的展开方向：'left' | 'right' | 'top' | 'bottom' */
    placement: {
      type: String,
      default: "right",
      validator: v => ["left", "right", "top", "bottom"].includes(v),
    },
    width: { type: Number, default: 260 },
    offset: { type: Number, default: 12 },
  });

  const emit = defineEmits(["enter", "leave"]);

  const style = computed(() => {
    let left = props.anchorX;
    let top = props.anchorY;
    let transform = "translate(0, 0)";

    switch (props.placement) {
      case "right":
        left = props.anchorX + props.offset;
        transform = "translate(0, -50%)";
        break;
      case "left":
        left = props.anchorX - props.offset;
        transform = "translate(-100%, -50%)";
        break;
      case "bottom":
        top = props.anchorY + props.offset;
        transform = "translate(-50%, 0)";
        break;
      case "top":
        top = props.anchorY - props.offset;
        transform = "translate(-50%, -100%)";
        break;
    }

    return {
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      width: `${props.width}px`,
      transform,
    };
  });

  function onEnter() {
    emit("enter");
  }
  function onLeave() {
    emit("leave");
  }
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
