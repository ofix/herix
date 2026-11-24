<template>
  <div
    ref="waveNavRef"
    class="wave-nav"
    @mouseleave="onRailLeave"
    @mousedown="onDragStart"
    @scroll.passive="onScroll"
    @mousemove="onSvgMouseMove"
  >
    <div class="spacer" :style="{ height: totalHeight + 'px' }" />

    <svg ref="svgRef" class="track-svg" :width="waveWidth" :height="waveHeight">
      <g :transform="`translate(0, ${-scrollTop + centerOffsetY})`">
        <line
          v-for="p in visibleWaves"
          :key="p.index"
          :x1="waveWidth - p.tickLen"
          :y1="p.y"
          :x2="waveWidth"
          :y2="p.y"
          stroke-linecap="round"
          :stroke-width="p.index === activeId ? 2.4 : 1.6"
          :stroke="p.index === activeId ? '#3794ff' : '#686d76'"
          class="tick-mark"
        />
      </g>
    </svg>

    <div class="fade-mask top" v-if="showTopFade"></div>
    <div class="fade-mask bottom" v-if="showBottomFade"></div>

    <!-- 外部通过默认插槽传入 popover，用 slot props 拿位置 -->
    <slot
      :visible="popoverVisible"
      :anchor-x="anchor.x"
      :anchor-y="anchor.y"
      :group="currentGroup"
      :index="hoverIndex"
      @enter="onPopoverEnter"
      @leave="onPopoverLeave"
    />
  </div>
</template>

<script setup>
  import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";

  const props = defineProps({
    groups: { type: Array, required: true },
    activeId: { type: Number, default: -1 },
    gap: { type: Number, default: 14 },
  });
  const emit = defineEmits(["select"]);

  /* ---------- 常量 ---------- */
  const waveWidth = 28;
  const padding = 40;
  const baseTickLength = 6;
  const maxTickLength = 14;
  const sigma = 22;
  const fadeThreshold = 8;
  const buffer = 6;

  /* ---------- DOM refs ---------- */
  const waveNavRef = ref(null);
  const svgRef = ref(null);

  /* ---------- 状态 ---------- */
  const scrollTop = ref(0);
  const waveHeight = ref(0);
  const hoverIndex = ref(-1);
  const hoverLogicY = ref(null);
  const popoverVisible = ref(false);
  const showTopFade = ref(false);
  const showBottomFade = ref(false);
  /** 锚点屏幕坐标（tick 右端） */
  const anchor = ref({ x: 0, y: 0 });

  const dragState = ref({
    isDragging: false,
    startY: 0,
    startScrollTop: 0,
  });

  let rafId = null;
  let pendingClient = null;
  let popoverHovered = false;
  let resizeObserver = null;

  /* 内容不足一屏时的垂直居中偏移 */
  const centerOffsetY = computed(() => {
    const extra = waveHeight.value - totalHeight.value;
    return extra > 0 ? extra / 2 : 0;
  });

  /* spacer 高度至少撑满容器，保证滚动区域和视觉一致 */
  const spacerHeight = computed(() => Math.max(totalHeight.value, waveHeight.value));
  /* ---------- 逻辑坐标 ---------- */
  const totalCount = computed(() => props.groups.length);

  const totalHeight = computed(() =>
    totalCount.value === 0 ? padding * 2 : padding * 2 + (totalCount.value - 1) * props.gap
  );

  function yOf(index) {
    return padding + index * props.gap;
  }

  const currentGroup = computed(() => {
    if (hoverIndex.value < 0) return null;
    return props.groups[hoverIndex.value].items || null;
  });

  /* ---------- 渲染窗口 ---------- */
  const visibleRange = computed(() => {
    const n = totalCount.value;
    if (n === 0) return { start: 0, end: -1 };

    const topLogic = scrollTop.value - padding;
    const bottomLogic = topLogic + waveHeight.value;

    let start = Math.floor(topLogic / props.gap) - buffer;
    let end = Math.ceil(bottomLogic / props.gap) + buffer;

    start = Math.max(0, start);
    end = Math.min(n - 1, end);

    if (end < start) end = start;
    return { start, end };
  });

  const visibleWaves = computed(() => {
    const { start, end } = visibleRange.value;
    if (end < start) return [];
    const list = [];
    for (let i = start; i <= end; i++) {
      const y = yOf(i);
      list.push({
        index: i,
        y,
        tickLen: calcTickLen(y),
      });
    }
    return list;
  });

  /* ---------- wave 计算 ---------- */
  function calcTickLen(y) {
    if (hoverLogicY.value === null) return baseTickLength;
    const dy = y - hoverLogicY.value;
    if (Math.abs(dy) > sigma * 3) return baseTickLength;
    const wave = Math.exp(-(dy * dy) / (2 * sigma * sigma));
    return baseTickLength + (maxTickLength - baseTickLength) * wave;
  }

  /* ---------- 交互 ---------- */
  function onSvgMouseMove(e) {
    if (dragState.value.isDragging) return;
    pendingClient = { x: e.clientX, y: e.clientY };
    if (!rafId) rafId = requestAnimationFrame(flush);
  }

  function flush() {
    rafId = null;
    if (!pendingClient || !svgRef.value || totalCount.value === 0) return;

    const svg = svgRef.value;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;

    const pt = svg.createSVGPoint();
    pt.x = pendingClient.x;
    pt.y = pendingClient.y;
    const svgP = pt.matrixTransform(ctm.inverse());

    const logicY = svgP.y + scrollTop.value - centerOffsetY.value;
    hoverLogicY.value = logicY;

    let nearest = Math.round((logicY - padding) / props.gap);
    nearest = Math.max(0, Math.min(totalCount.value - 1, nearest));
    hoverIndex.value = nearest;

    // tick 右端屏幕坐标作为锚点
    const tickPt = svg.createSVGPoint();
    tickPt.x = waveWidth;
    tickPt.y = yOf(nearest);
    const screenP = tickPt.matrixTransform(ctm);

    anchor.value = { x: screenP.x, y: screenP.y };
    popoverVisible.value = true;
  }

  function onRailLeave() {
    if (dragState.value.isDragging) return;
    hoverIndex.value = -1;
    hoverLogicY.value = null;
    pendingClient = null;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    nextTick(() => {
      if (!popoverHovered) popoverVisible.value = false;
    });
  }

  function onPopoverEnter() {
    popoverHovered = true;
  }

  function onPopoverLeave() {
    popoverHovered = false;
    if (!dragState.value.isDragging) {
      popoverVisible.value = false;
      hoverIndex.value = -1;
      hoverLogicY.value = null;
    }
  }

  /* ---------- 拖拽 ---------- */
  function onDragStart(e) {
    if (e.button !== 0) return;
    if (e.target.closest(".tick-mark")) return;
    dragState.value.isDragging = true;
    dragState.value.startY = e.clientY;
    dragState.value.startScrollTop = waveNavRef.value.scrollTop;
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
    document.body.style.cursor = "grabbing";
  }

  function onDragMove(e) {
    if (!dragState.value.isDragging) return;
    const deltaY = e.clientY - dragState.value.startY;
    waveNavRef.value.scrollTop = dragState.value.startScrollTop - deltaY;
  }

  function onDragEnd() {
    dragState.value.isDragging = false;
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
    document.body.style.cursor = "";
  }

  /* ---------- 滚动 / fade ---------- */
  function onScroll() {
    const el = waveNavRef.value;
    if (!el) return;
    scrollTop.value = el.scrollTop;
    updateFade(el);
  }

  function updateFade(el = waveNavRef.value) {
    if (!el) return;
    showTopFade.value = el.scrollTop > fadeThreshold;
    showBottomFade.value = el.scrollTop + el.clientHeight < el.scrollHeight - fadeThreshold;
  }

  /* ---------- 尺寸 ---------- */
  function syncwaveHeight() {
    const el = waveNavRef.value;
    if (!el) return;
    waveHeight.value = el.clientHeight;
    scrollTop.value = el.scrollTop;
    updateFade(el);
  }

  onMounted(() => {
    syncwaveHeight();
    nextTick(syncwaveHeight);
    resizeObserver = new ResizeObserver(syncwaveHeight);
    if (waveNavRef.value) resizeObserver.observe(waveNavRef.value);
  });

  onUnmounted(() => {
    if (rafId) cancelAnimationFrame(rafId);
    if (resizeObserver) resizeObserver.disconnect();
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
    document.body.style.cursor = "";
  });

  /* ---------- 外部切 activeId 自动居中 ---------- */
  watch(
    () => props.activeId,
    id => {
      if (id < 0 || !waveNavRef.value) return;
      const el = waveNavRef.value;
      const targetY = yOf(id);
      const top = targetY - el.clientHeight / 2;
      const maxScroll = Math.max(0, totalHeight.value - el.clientHeight);
      el.scrollTop = Math.max(0, Math.min(top, maxScroll));
    }
  );

  watch(totalCount, () => {
    nextTick(() => {
      syncwaveHeight();
    });
  });

  /* 暴露给外部（可选） */
  defineExpose({ hoverIndex, anchor });
</script>

<style scoped>
  .wave-nav {
    position: relative;
    right: 4px;
    width: 32px;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    flex-shrink: 0;
    cursor: grab;
    scrollbar-width: none;
    user-select: none;
  }
  .wave-nav:active {
    cursor: grabbing;
  }
  .wave-nav::-webkit-scrollbar {
    display: none;
  }

  .spacer {
    width: 1px;
    pointer-events: none;
  }

  .track-svg {
    position: absolute;
    top: 0;
    left: 0;
    display: block;
    pointer-events: none;
  }

  .tick-mark {
    pointer-events: none;
  }

  .fade-mask {
    position: absolute;
    left: 0;
    right: 0;
    height: 30px;
    pointer-events: none;
    z-index: 2;
  }
  .fade-mask.top {
    top: 0;
    background: linear-gradient(to bottom, #1f2024, transparent);
  }
  .fade-mask.bottom {
    bottom: 0;
    background: linear-gradient(to top, #1f2024, transparent);
  }
</style>
