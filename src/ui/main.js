/**
 * UI 入口：注册 Monaco worker、Element Plus、全局样式，挂载 App。
 * Monaco 在 Electron(file://) 下必须用 ?worker 打包，否则 new Worker 相对路径解析失败。
 */
import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
import './styles.css';
import App from './App.vue';

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

globalThis.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') return new jsonWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

createApp(App).use(ElementPlus).mount('#app');
