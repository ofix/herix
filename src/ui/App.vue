<template>
  <div class="shell">
    <!-- 最左侧固定 ActivityBar，宽度写死，不参与splitter -->
    <ActivityBar />

    <!-- 第二层：Sidebar（可拖动） + 主工作区 -->
    <el-splitter class="work-h" layout="horizontal">
      <el-splitter-panel size="240px" :min="160" :max="600">
        <SidebarPanels />
      </el-splitter-panel>

      <el-splitter-panel>
        <!-- 主区域：编辑器 + 底部面板（垂直分割） -->
        <el-splitter class="work-v" layout="vertical">
          <el-splitter-panel>
            <div class="upper">
              <EditorArea />
            </div>
          </el-splitter-panel>
          <el-splitter-panel size="232px" :min="120" :max="520">
            <BottomPanel />
          </el-splitter-panel>
        </el-splitter>
      </el-splitter-panel>
    </el-splitter>
  </div>
</template>

<script setup>
  import { onMounted } from "vue";
  import ActivityBar from "./components/ActivityBar.vue";
  import SidebarPanels from "./components/SidebarPanels.vue";
  import EditorArea from "./components/EditorArea.vue";
  import BottomPanel from "./components/BottomPanel.vue";
  import { initChat } from "./stores/chat.js";
  import { initTree } from "./stores/project.js";

  onMounted(() => {
    void initChat();
    void initTree();
  });
</script>

<style scoped>
  .shell {
    height: 100%;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }
  .work-h,
  .work-v {
    flex: 1;
    min-width: 0;
    width: 100%;
    height: 100%;
  }
  .upper {
    display: flex;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  /* 拖拽条贴近 VSCode */
  :deep(.el-splitter-bar) {
    background: #2a2c30;
    transition: background 0.15s ease;
  }
  :deep(.el-splitter-bar:hover) {
    background: #3794ff;
  }
  :deep(.el-splitter-bar__collapse-bar) {
    display: none;
  }
  :deep(.el-splitter-panel) {
    min-width: 0;
    min-height: 0;
  }
</style>
