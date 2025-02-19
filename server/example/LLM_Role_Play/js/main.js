// example/LLM_Role_Play/js/main.js

import * as ui from './ui.js';
import * as settings from './settings.js';
import * as log from './log.js';
import * as pageSettings from './pageSettings.js';
import { connectToServer } from "./socket.js";
import { applyTheme } from './style.js'; //  导入 applyTheme
import { updateUIText } from './settings.js';

// 显示加载遮罩
function showLoadingOverlay() {
  document.getElementById('loading-overlay').style.display = 'flex';
}

// 隐藏加载遮罩
function hideLoadingOverlay() {
  document.getElementById('loading-overlay').style.display = 'none';
}

let isInitialized = false; // 标记是否已经初始化

document.addEventListener('DOMContentLoaded', async () => {
  if (isInitialized) return;
  isInitialized = true;

  showLoadingOverlay();

  // 模态框的 ID 和对应的 HTML 文件名
  const modalsInfo = [
    { id: 'chat-settings-modal', htmlFile: 'chat_settings.html' },
    { id: 'chat-history-modal', htmlFile: 'chat_history.html' },
    { id: 'system-settings-modal', htmlFile: 'system_settings.html' },
    { id: 'page-settings-modal', htmlFile: 'page_settings.html' },
    { id: 'character-select-modal', htmlFile: 'character_select.html' },
  ];

  // 加载 HTML
  try {
    for (const modalInfo of modalsInfo) {
      const modal = document.getElementById(modalInfo.id);
      if (!modal) {
        console.error(`Modal element not found for ID: ${modalInfo.id}`);
        continue;
      }
      const modalContent = modal.querySelector('.modal-content');
      if (!modalContent) {
        console.error(`Modal content not found for ID: ${modalInfo.id}`);
        continue;
      }

      const htmlResponse = await fetch(`html/${modalInfo.htmlFile}`);
      if (!htmlResponse.ok) {
        throw new Error(`Failed to load HTML for ${modalInfo.id}: ${htmlResponse.status} ${htmlResponse.statusText}`);
      }
      const html = await htmlResponse.text();
      modalContent.innerHTML = html;
      if (modalInfo.id === 'system-settings-modal') {
        log.initLogFilter();//初始化
      }
    }
  } catch (error) {
    console.error('Error loading modal content:', error);
  }

  // 在这里调用 setupModalOpenCloseHandlers
  ui.setupModalOpenCloseHandlers();
  // 初始化 UI 控件的事件监听器
  ui.initModalControls();

  // 加载设置
  await settings.loadSettings();
  await pageSettings.loadPageSettings();
  //更新多语言
  updateUIText();
  // 根据保存的设置应用初始主题
  const currentSettings = settings.getSettings();
  applyTheme(currentSettings['theme-select']);

  // 连接到服务器
  connectToServer();

  hideLoadingOverlay();
});

export { showLoadingOverlay, hideLoadingOverlay }