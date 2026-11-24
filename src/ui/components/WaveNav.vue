<template>
  <div
    ref="waveNavRef"
    class="wave-nav"
    :class="`is-${position}`"
    @mouseleave="onRailLeave"
    @mousedown="onDragStart"
    @scroll.passive="onScroll"
    @mousemove="onSvgMouseMove"
  >
    <div
      class="spacer"
      :style="isHorizontal ? { width: spacerSize + 'px' } : { height: spacerSize + 'px' }"
    />

    <svg ref="svgRef" class="track-svg" :width="svgWidth" :height="svgHeight">
      <g :transform="groupTransform">
        <line
          v-for="p in visibleWaves"
          :key="p.index"
          :x1="p.x1"
          :y1="p.y1"
          :x2="p.x2"
          :y2="p.y2"
          stroke-linecap="round"
          :stroke-width="p.index === activeId ? 2.4 : 1.6"
          :stroke="p.index === activeId ? '#3794ff' : '#686d76'"
          class="tick-mark"
        />
      </g>
    </svg>

    <div class="fade-mask start" v-if="showStartFade"></div>
    <div class="fade-mask end" v-if="showEndFade"></div>
    <slot
      :visible="popoverVisible"
      :index="hoverIndex"
      :anchor-x="anchor.x"
      :anchor-y="anchor.y"
      :placement="popoverPlacement"
      :on-enter="onPopoverEnter"
      :on-leave="onPopoverLeave"
    />
  </div>
</template>

<script setup>
  import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";

  const props = defineProps({
    /** 导航点数量（组数） */
    count: { type: Number, default: 0 },
    /** 当前激活组 index */
    activeId: { type: Number, default: -1 },
    gap: { type: Number, default: 14 },
    /** 'top' | 'bottom' | 'left' | 'right' */
    position: {
      type: String,
      default: "left",
      validator: v => ["top", "bottom", "left", "right"].includes(v),
    },
    crossSize: { type: Number, default: 28 },
    padding: { type: Number, default: 40 },
  });
  const emit = defineEmits(["select"]);

  /* ---------- 常量 ---------- */
  const baseTickLength = 6;
  const maxTickLength = 14;
  const sigma = 22;
  const fadeThreshold = 8;
  const buffer = 6;
  const smoothDuration = 220;

  /* ---------- DOM refs ---------- */
  const waveNavRef = ref(null);
  const svgRef = ref(null);

  /* ---------- 状态 ---------- */
  const scrollTop = ref(0);
  const scrollLeft = ref(0);
  const mainAxisSize = ref(0);
  const hoverIndex = ref(-1);
  const hoverLogicMain = ref(null);
  const popoverVisible = ref(false);
  const showStartFade = ref(false);
  const showEndFade = ref(false);
  const anchor = ref({ x: 0, y: 0 });

  const dragState = ref({
    isDragging: false,
    startMain: 0,
    startScroll: 0,
  });

  let rafId = null;
  let pendingClient = null;
  let popoverHovered = false;
  let resizeObserver = null;
  let smoothRafId = null;

  /* ---------- 方向 ---------- */
  const isHorizontal = computed(() => props.position === "top" || props.position === "bottom");

  const svgWidth = computed(() => (isHorizontal.value ? mainAxisSize.value : props.crossSize));
  const svgHeight = computed(() => (isHorizontal.value ? props.crossSize : mainAxisSize.value));

  /* ---------- 逻辑坐标 ---------- */
  const totalCount = computed(() => Math.max(0, props.count));

  const totalMain = computed(() =>
    totalCount.value === 0
      ? props.padding * 2
      : props.padding * 2 + (totalCount.value - 1) * props.gap
  );

  function mainOf(index) {
    return props.padding + index * props.gap;
  }

  const centerOffset = computed(() => {
    const extra = mainAxisSize.value - totalMain.value;
    return extra > 0 ? extra / 2 : 0;
  });

  const spacerSize = computed(() => Math.max(totalMain.value, mainAxisSize.value));

  const groupTransform = computed(() => {
    if (isHorizontal.value) {
      return `translate(${-scrollLeft.value + centerOffset.value}, 0)`;
    }
    return `translate(0, ${-scrollTop.value + centerOffset.value})`;
  });

  /* ---------- 渲染窗口 ---------- */
  const visibleRange = computed(() => {
    const n = totalCount.value;
    if (n === 0) return { start: 0, end: -1 };

    const scrollMain = isHorizontal.value ? scrollLeft.value : scrollTop.value;
    const topLogic = scrollMain - props.padding - centerOffset.value;
    const bottomLogic = topLogic + mainAxisSize.value;

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
      const main = mainOf(i);
      const tickLen = calcTickLen(main);
      list.push(buildTick(i, main, tickLen));
    }
    return list;
  });

  function buildTick(index, main, tickLen) {
    const cross = props.crossSize;
    switch (props.position) {
      case "top":
        return { index, x1: main, y1: 0, x2: main, y2: tickLen };
      case "bottom":
        return { index, x1: main, y1: cross - tickLen, x2: main, y2: cross };
      case "left":
        return { index, x1: 0, y1: main, x2: tickLen, y2: main };
      case "right":
        return { index, x1: cross - tickLen, y1: main, x2: cross, y2: main };
      default:
        return { index, x1: 0, y1: main, x2: tickLen, y2: main };
    }
  }

  /* ---------- wave ---------- */
  function calcTickLen(main) {
    if (hoverLogicMain.value === null) return baseTickLength;
    const dy = main - hoverLogicMain.value;
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

    const localMain = isHorizontal.value ? svgP.x : svgP.y;
    const scrollMain = isHorizontal.value ? scrollLeft.value : scrollTop.value;

    const logicMain = localMain + scrollMain - centerOffset.value;
    hoverLogicMain.value = logicMain;

    let nearest = Math.round((logicMain - props.padding) / props.gap);
    nearest = Math.max(0, Math.min(totalCount.value - 1, nearest));
    hoverIndex.value = nearest;

    anchor.value = computeAnchor(nearest, ctm);
    popoverVisible.value = true;
  }

  function computeAnchor(index, ctm) {
    const svg = svgRef.value;
    const main = mainOf(index);
    const cross = props.crossSize;
    const pt = svg.createSVGPoint();
    switch (props.position) {
      case "top":
        pt.x = main;
        pt.y = cross;
        break;
      case "bottom":
        pt.x = main;
        pt.y = 0;
        break;
      case "left":
        pt.x = cross;
        pt.y = main;
        break;
      case "right":
        pt.x = 0;
        pt.y = main;
        break;
      default:
        pt.x = cross;
        pt.y = main;
    }
    const screenP = pt.matrixTransform(ctm);
    return { x: screenP.x, y: screenP.y };
  }

  function onRailLeave() {
    if (dragState.value.isDragging) return;
    hoverIndex.value = -1;
    hoverLogicMain.value = null;
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
      hoverLogicMain.value = null;
    }
  }

  /* ---------- 拖拽 ---------- */
  function onDragStart(e) {
    if (e.button !== 0) return;
    if (e.target.closest(".tick-mark")) return;
    dragState.value.isDragging = true;
    dragState.value.startMain = isHorizontal.value ? e.clientX : e.clientY;
    dragState.value.startScroll = isHorizontal.value
      ? waveNavRef.value.scrollLeft
      : waveNavRef.value.scrollTop;
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
    document.body.style.cursor = "grabbing";
  }

  function onDragMove(e) {
    if (!dragState.value.isDragging) return;
    const current = isHorizontal.value ? e.clientX : e.clientY;
    const delta = current - dragState.value.startMain;
    const el = waveNavRef.value;
    if (isHorizontal.value) {
      el.scrollLeft = dragState.value.startScroll - delta;
    } else {
      el.scrollTop = dragState.value.startScroll - delta;
    }
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
    scrollLeft.value = el.scrollLeft;
    updateFade(el);
  }

  function updateFade(el = waveNavRef.value) {
    if (!el) return;
    if (isHorizontal.value) {
      showStartFade.value = el.scrollLeft > fadeThreshold;
      showEndFade.value = el.scrollLeft + el.clientWidth < el.scrollWidth - fadeThreshold;
    } else {
      showStartFade.value = el.scrollTop > fadeThreshold;
      showEndFade.value = el.scrollTop + el.clientHeight < el.scrollHeight - fadeThreshold;
    }
  }

  /* ---------- 尺寸 ---------- */
  function syncSize() {
    const el = waveNavRef.value;
    if (!el) return;
    mainAxisSize.value = isHorizontal.value ? el.clientWidth : el.clientHeight;
    scrollTop.value = el.scrollTop;
    scrollLeft.value = el.scrollLeft;
    updateFade(el);
  }

  onMounted(() => {
    syncSize();
    nextTick(syncSize);
    resizeObserver = new ResizeObserver(syncSize);
    if (waveNavRef.value) resizeObserver.observe(waveNavRef.value);
  });

  onUnmounted(() => {
    if (rafId) cancelAnimationFrame(rafId);
    if (smoothRafId) cancelAnimationFrame(smoothRafId);
    if (resizeObserver) resizeObserver.disconnect();
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
    document.body.style.cursor = "";
  });

  /* ---------- 外部 activeId 自动居中 ---------- */
  watch(
    () => props.activeId,
    id => {
      if (id < 0 || id >= totalCount.value || !waveNavRef.value) return;
      const el = waveNavRef.value;
      const target = mainOf(id);
      if (isHorizontal.value) {
        const left = target - el.clientWidth / 2;
        const maxScroll = Math.max(0, totalMain.value - el.clientWidth);
        el.scrollLeft = Math.max(0, Math.min(left, maxScroll));
      } else {
        const top = target - el.clientHeight / 2;
        const maxScroll = Math.max(0, totalMain.value - el.clientHeight);
        el.scrollTop = Math.max(0, Math.min(top, maxScroll));
      }
    }
  );

  /* ---------- 组数变化：重置越界 hover / 关闭 popover ---------- */
  watch(totalCount, n => {
    nextTick(() => {
      syncSize();
      if (n === 0) {
        hidePopover();
        return;
      }
      if (hoverIndex.value >= n) {
        hoverIndex.value = -1;
        hoverLogicMain.value = null;
        popoverVisible.value = false;
        popoverHovered = false;
      }
    });
  });

  /* ---------- 对外接口 ---------- */
  function setScrollValue(value) {
    const el = waveNavRef.value;
    if (!el) return;
    if (isHorizontal.value) el.scrollLeft = value;
    else el.scrollTop = value;
  }

  /** popover 展开方向：与 rail 贴边方向相反，往矩形内侧展开 */
  const popoverPlacement = computed(() => {
    switch (props.position) {
      case "left":
        return "right";
      case "right":
        return "left";
      case "top":
        return "bottom";
      case "bottom":
        return "top";
      default:
        return "right";
    }
  });

  function targetScrollForIndex(index) {
    const el = waveNavRef.value;
    if (!el) return 0;
    const main = mainOf(index);
    const clientMain = isHorizontal.value ? el.clientWidth : el.clientHeight;
    const maxScroll = Math.max(0, totalMain.value - clientMain);
    return Math.max(0, Math.min(main - clientMain / 2, maxScroll));
  }

  function animateScrollTo(target, duration, index) {
    const el = waveNavRef.value;
    if (!el) return;
    const start = isHorizontal.value ? el.scrollLeft : el.scrollTop;
    const distance = target - start;
    if (Math.abs(distance) < 1) {
      setScrollValue(target);
      return;
    }
    const startTime = performance.now();
    if (smoothRafId) cancelAnimationFrame(smoothRafId);

    function step(now) {
      // 组数变化导致 index 越界，取消缓动
      if (index >= totalCount.value) {
        smoothRafId = null;
        return;
      }
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setScrollValue(start + distance * eased);
      if (t < 1) {
        smoothRafId = requestAnimationFrame(step);
      } else {
        smoothRafId = null;
      }
    }
    smoothRafId = requestAnimationFrame(step);
  }

  function showPopoverAt(index) {
    if (index < 0 || index >= totalCount.value) return;
    if (!svgRef.value) return;
    const ctm = svgRef.value.getScreenCTM();
    if (!ctm) return;
    hoverIndex.value = index;
    hoverLogicMain.value = mainOf(index);
    anchor.value = computeAnchor(index, ctm);
    popoverVisible.value = true;
  }

  function hidePopover() {
    popoverVisible.value = false;
    hoverIndex.value = -1;
    hoverLogicMain.value = null;
    popoverHovered = false;
  }

  function scrollToIndex(index, opts = {}) {
    if (index < 0 || index >= totalCount.value) return;
    const smooth = opts.smooth ?? popoverVisible.value;
    const target = targetScrollForIndex(index);

    if (smooth) {
      hoverIndex.value = index;
      hoverLogicMain.value = mainOf(index);
      popoverVisible.value = true;
      animateScrollTo(target, opts.duration ?? smoothDuration, index);
      // 滚动过程中每帧重算锚点，保证 popover 跟手
      const updateAnchorDuringScroll = () => {
        if (!smoothRafId) return;
        if (index >= totalCount.value) return;
        if (svgRef.value) {
          const ctm = svgRef.value.getScreenCTM();
          if (ctm) anchor.value = computeAnchor(index, ctm);
        }
        requestAnimationFrame(updateAnchorDuringScroll);
      };
      requestAnimationFrame(updateAnchorDuringScroll);
    } else {
      setScrollValue(target);
      nextTick(() => showPopoverAt(index));
    }
  }

  defineExpose({
    scrollToIndex,
    showPopoverAt,
    hidePopover,
    hoverIndex,
    anchor,
    onPopoverEnter,
    onPopoverLeave,
  });
</script>

<style scoped>
  .wave-nav {
    position: relative;
    flex-shrink: 0;
    scrollbar-width: none;
    user-select: none;
    cursor: grab;
  }
  .wave-nav:active {
    cursor: grabbing;
  }
  .wave-nav::-webkit-scrollbar {
    display: none;
  }

  .wave-nav.is-top,
  .wave-nav.is-bottom {
    width: 100%;
    height: v-bind("crossSize + 'px'");
    overflow-x: auto;
    overflow-y: hidden;
  }
  .wave-nav.is-left,
  .wave-nav.is-right {
    width: v-bind("crossSize + 'px'");
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .wave-nav.is-top {
    top: 4px;
  }
  .wave-nav.is-bottom {
    bottom: 4px;
  }
  .wave-nav.is-left {
    left: 4px;
  }
  .wave-nav.is-right {
    right: 4px;
  }

  .spacer {
    pointer-events: none;
    width: 1px;
    height: 1px;
  }

  .track-svg {
    position: absolute;
    pointer-events: none;
  }
  .wave-nav.is-top .track-svg {
    top: 0;
    left: 0;
  }
  .wave-nav.is-bottom .track-svg {
    bottom: 0;
    left: 0;
  }
  .wave-nav.is-left .track-svg {
    top: 0;
    left: 0;
  }
  .wave-nav.is-right .track-svg {
    top: 0;
    right: 0;
  }

  .tick-mark {
    pointer-events: none;
  }

  .fade-mask {
    position: absolute;
    pointer-events: none;
    z-index: 2;
  }
  .wave-nav.is-top .fade-mask.start,
  .wave-nav.is-bottom .fade-mask.start {
    left: 0;
    top: 0;
    bottom: 0;
    width: 30px;
    background: linear-gradient(to right, #1f2024, transparent);
  }
  .wave-nav.is-top .fade-mask.end,
  .wave-nav.is-bottom .fade-mask.end {
    right: 0;
    top: 0;
    bottom: 0;
    width: 30px;
    background: linear-gradient(to left, #1f2024, transparent);
  }
  .wave-nav.is-left .fade-mask.start,
  .wave-nav.is-right .fade-mask.start {
    top: 0;
    left: 0;
    right: 0;
    height: 30px;
    background: linear-gradient(to bottom, #1f2024, transparent);
  }
  .wave-nav.is-left .fade-mask.end,
  .wave-nav.is-right .fade-mask.end {
    bottom: 0;
    left: 0;
    right: 0;
    height: 30px;
    background: linear-gradient(to top, #1f2024, transparent);
  }
</style>
