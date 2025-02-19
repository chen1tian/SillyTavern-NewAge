// example/LLM_Role_Play/js/ui.js

import * as settings from "./settings.js";
import * as pageSettings from "./pageSettings.js";
import * as log from './log.js'; //  导入 log.js
import { sendNonStreamMessage } from "./socket.js";
import { updateUIText } from "./settings.js";
import { applyTheme, updateThemeSelect, saveCustomTheme, loadCustomThemes } from './style.js';

//  打开模态框
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    //  设置为 block
    modal.style.display = 'block'; //  设置为 block
    modal.classList.add('show'); // 添加 show 类
    document.body.classList.add('modal-open');
    updateUIText();//打开就更新
  }
}

// 关闭模态框
function closeModal() {
  const modals = document.querySelectorAll('.modal');
  modals.forEach(modal => {
    modal.classList.remove('show'); // 移除 show 类

    //  立即检查并移除 modal-open
    let hasVisibleModal = false;
    modals.forEach(otherModal => {
      if (otherModal !== modal && otherModal.classList.contains('show')) {
        hasVisibleModal = true;
      }
    });
    if (!hasVisibleModal) {
      document.body.classList.remove('modal-open');
    }
    // 动画结束后再隐藏 (避免闪烁)
    setTimeout(() => {
      modal.style.display = 'none'; //
    }, 300);
  });
}
//  处理模态框打开/关闭事件
function setupModalOpenCloseHandlers() {
  //  将事件监听器绑定到 document 上 (事件委托)
  document.addEventListener('click', (event) => {
    const target = event.target;

    // 打开模态框按钮
    const button = target.closest('[id$="-btn"]'); //  使用 closest
    if (button) {
      const modalId = button.id.replace('-btn', '-modal');
      openModal(modalId);
    }

    // 关闭模态框按钮
    if (target.matches('.close-button')) {
      closeModal();
    }
  });

  // 点击模态框外部区域时关闭模态框 (保持不变)
  window.addEventListener('click', (event) => {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
      if (event.target === modal) {
        closeModal();
      }
    });
  });
}

//  处理系统设置保存 (事件委托)
function setupSystemSettingsHandlers() {
  const systemSettingsModal = document.getElementById('system-settings-modal');
  if (systemSettingsModal) {
    const modalContent = systemSettingsModal.querySelector('.modal-content');
    if (modalContent) {
      //  将元素的获取移到事件监听器外部
      const elements = modalContent.querySelectorAll('input, select, textarea');

      modalContent.addEventListener('click', (event) => {
        if (event.target.id === 'save-settings-btn') {
          //  从 DOM 中读取值，更新到 JSON 文件
          const data = {};
          elements.forEach(el => { //  使用预先获取的 elements
            if (el.type === 'checkbox') {
              data[el.id] = el.checked;
            } else if (el.type === 'radio') {
              if (el.checked) {
                data[el.name] = el.value;
              }
            } else {
              data[el.id] = el.value;
            }
          });

          //  调用 settings.saveSettings，传入数据
          settings.saveSettings(data); //  移除 await 和 updateUIText
        }
      });
    }
  }
}

//  处理语言切换 (事件委托)
function setupLanguageChangeHandler() {
  const systemSettingsModal = document.getElementById('system-settings-modal');
  if (systemSettingsModal) {
    const modalContentEl = systemSettingsModal.querySelector('.modal-content');
    if (modalContentEl) {
      modalContentEl.addEventListener('change', (event) => {
        if (event.target.id === 'language-select') {
          //  调用 settings.saveSettings，传入数据
          settings.saveSettings({ 'language-select': event.target.value }); //  键名加引号
          settings.applySettings({ 'language-select': event.target.value }); //不需要了
        }
      });
    }
  }
}
//处理主题切换 (事件委托)
function setupThemeChangeHandler() {
  const pageSettingsModal = document.getElementById('page-settings-modal');
  if (pageSettingsModal) {
    const modalContentEl = pageSettingsModal.querySelector('.modal-content');
    if (modalContentEl) {
      modalContentEl.addEventListener('change', (event) => {
        if (event.target.id === 'theme-select') {
          const themeSelect = document.getElementById('theme-select');
          if (themeSelect) {
            const theme = themeSelect.value;
            applyTheme(theme); //  在这里切换主题
          }
        }
      });
      // 【新增】在模态框打开时，更新一次下拉列表
      updateThemeSelect();
    }
  }
}



//  处理页面设置保存 (事件委托)
function setupPageSettingsHandlers() {
  const pageSettingsModal = document.getElementById('page-settings-modal');
  if (pageSettingsModal) {
    const modalContent = pageSettingsModal.querySelector('.modal-content');
    if (modalContent) {
      //  提前获取所有相关的 HTML 元素
      const elements = modalContent.querySelectorAll('input, select, textarea');
      const colorInputs = modalContent.querySelectorAll('input[type="color"]'); // 【新增】

      // 【新增】 初始设置颜色
      colorInputs.forEach(input => {
        applyColor(input);

        // 【修改】 监听 input 事件 (改为 input 事件)
        input.addEventListener('input', function () {
          applyColor(this);
        });
      });

      modalContent.addEventListener('click', (event) => {
        if (event.target.id === 'save-page-settings-btn') {
          // 从 DOM 中读取值，更新到 JSON 对象
          const data = {};
          elements.forEach(el => {
            if (el.type === 'checkbox') {
              data[el.id] = el.checked;
            } else if (el.tagName === 'SELECT' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
              //  对于 select, input, textarea，直接获取值
              data[el.id] = el.value;
            }
          });

          //  调用 pageSettings.savePageSettings，传入数据
          pageSettings.savePageSettings(data); //  移除 await
        }
      });
    }
  }
}

//  处理背景文件选择 (事件委托)
function setupBackgroundFileHandler() {
  const pageSettingsModal = document.getElementById('page-settings-modal');
  if (pageSettingsModal) {
    const modalContentEl = pageSettingsModal.querySelector('.modal-content');
    if (modalContentEl) {
      modalContentEl.addEventListener('change', (event) => {
        if (event.target.id === 'bg-file-input') {
          const file = event.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
              const bgInput = document.getElementById('bg-input');
              if (bgInput) {
                bgInput.value = e.target.result; // 将DataURL赋值给URL输入框
              }
            };
            reader.readAsDataURL(file); //  读取文件为 DataURL
          }
        }
      });
    }
  }
}

//  处理背景适应模式更改 (事件委托)
function setupBackgroundFitHandler() {
  const pageSettingsModal = document.getElementById('page-settings-modal');
  if (pageSettingsModal) {
    const modalContentEl = pageSettingsModal.querySelector('.modal-content');
    if (modalContentEl) {
      modalContentEl.addEventListener('change', (event) => {
        if (event.target.id === 'bg-fit-select') {
          const bgFit = event.target.value
          //  移除所有适应模式类
          document.body.classList.remove('bg-cover', 'bg-contain', 'bg-fill', 'bg-none', 'bg-repeat', 'bg-fixed');
          //  添加新的适应模式类
          document.body.classList.add(`bg-${bgFit}`);
          //  保存
          localStorage.setItem('bgFit', bgFit);
        }
      });
    }
    //  在 DOMContentLoaded 中，页面加载完成后，应用背景适应设置
    const bgFit = localStorage.getItem('bgFit');
    if (bgFit) {
      document.body.classList.add(`bg-${bgFit}`);
    } else { // 如果没有设置，则默认为 'cover'
      document.body.classList.add('bg-cover');
    }
  }
}

//  处理布局切换 (事件委托)
function setupLayoutSwitchHandler() {
  const pageSettingsModal = document.getElementById('page-settings-modal');
  if (pageSettingsModal) {
    const modalContentEl = pageSettingsModal.querySelector('.modal-content');
    if (modalContentEl) {
      modalContentEl.addEventListener('change', (event) => {
        if (event.target.id === 'layout-switch') {
          const isVertical = event.target.checked;
          updateLayout(isVertical); // 更新布局
          localStorage.setItem('isVertical', isVertical); // 保存布局状态
        }
      });
    }
    //  在 DOMContentLoaded 中，页面加载完成后，应用布局设置
    const isVertical = localStorage.getItem('isVertical') === 'true';
    updateLayout(isVertical);

    // 强制更新切换开关的状态
    const layoutSwitch = document.getElementById('layout-switch');
    if (layoutSwitch) {
      layoutSwitch.checked = isVertical;
    }
  }
}

//  处理自动适应方向 (事件委托)
function setupAutoOrientationHandler() {
  const pageSettingsModal = document.getElementById('page-settings-modal');
  if (pageSettingsModal) {
    const modalContentEl = pageSettingsModal.querySelector('.modal-content');
    if (modalContentEl) {
      modalContentEl.addEventListener('change', (event) => {
        if (event.target.id === 'auto-orientation') {
          const isAuto = event.target.checked;
          localStorage.setItem('autoOrientation', isAuto); // 保存设置
          if (isAuto) {
            window.addEventListener('orientationchange', handleOrientationChange);
          } else {
            window.removeEventListener('orientationchange', handleOrientationChange);
          }
        }
      });
    }
    //  在 DOMContentLoaded 中，页面加载完成后，应用自动适应方向设置
    const isAuto = localStorage.getItem('autoOrientation') === 'true';
    const autoOrientationCheckbox = document.getElementById('auto-orientation'); // 获取复选框元素
    if (isAuto) {
      window.addEventListener('orientationchange', handleOrientationChange);
      if (autoOrientationCheckbox) {
        autoOrientationCheckbox.checked = true; //  设置复选框的选中状态
      }
    } else {
      if (autoOrientationCheckbox) {
        autoOrientationCheckbox.checked = false;//  设置复选框的选中状态
      }
      window.removeEventListener('orientationchange', handleOrientationChange);
    }
  }
}

// 处理消息输入框 (事件委托)
function setupMessageSend() {
  // ... (与之前相同)
  document.addEventListener('click', (event) => {
    if (event.target.id === 'send-button') {
      const userInput = document.getElementById('user-input');
      if (userInput) {
        const message = userInput.value.trim();
        if (message) {
          sendNonStreamMessage(message);
          userInput.value = '';
        }
      }
    }
  });

  //  回车发送消息 (仍然直接绑定到 textarea 上)
  const userInput = document.getElementById('user-input');
  if (userInput) {
    userInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const message = userInput.value.trim();
        if (message) {
          sendNonStreamMessage(message);
          userInput.value = '';
        }
      }
    });
  }
}

//  更新布局的函数 (保持不变)
function updateLayout(isVertical) {
  // ... (与之前相同)
  if (isVertical) {
    document.body.classList.remove('horizontal-layout');
    document.body.classList.add('vertical-layout');
  } else {
    document.body.classList.remove('vertical-layout');
    document.body.classList.add('horizontal-layout');
  }
}

//  处理设备方向变化的函数 (保持不变)
function handleOrientationChange() {
  // ... (与之前相同)
  const isPortrait = window.matchMedia('(orientation: portrait)').matches;
  updateLayout(isPortrait);

  // 强制更新切换开关的状态 (因为方向改变时，切换开关本身不会触发 change 事件)
  const layoutSwitch = document.getElementById('layout-switch'); //  在这里获取 layoutSwitch
  if (layoutSwitch) {
    layoutSwitch.checked = isPortrait;
  }
}


//【新增】
function applyColor(input) {
  const elementId = input.id; // 获取 input 的 ID
  const color = input.value; // 获取 input 的值

  // 根据 input 的 ID 设置对应元素的样式 (使用 data-* 属性)
  switch (elementId) {
    case 'header-bg-color':
      document.querySelector('header').style.backgroundColor = color;
      break;
    case 'header-font-color':
      document.querySelector('header').style.color = color;
      break;
    case 'main-bg-color':
      document.querySelector('main').style.backgroundColor = color;
      break;
    case 'main-font-color':
      document.querySelector('main').style.color = color;
      break;
    case 'footer-bg-color':
      document.querySelector('footer').style.backgroundColor = color;
      break;
    case 'footer-font-color':
      document.querySelector('footer').style.color = color;
      break;
    case 'container-bg-color':
      document.querySelector('.container').style.backgroundColor = color;
      break;
    case 'button-group-bg-color':
      document.querySelector('.button-group').style.backgroundColor = color;
      break;
    // 【新增】引号颜色
    case 'double-quote-color':
    case 'single-quote-color':
      applyTheme(localStorage.getItem('selectedTheme')); //【新增】
      break;
  }
}
// 【修改】保存自定义主题的逻辑 (不再需要 temporaryTheme, originalTheme)
async function setupSaveCustomThemeHandler() {
  const pageSettingsModal = document.getElementById('page-settings-modal');
  if (!pageSettingsModal) return;

  const applyButton = document.getElementById('apply-custom-theme-btn');
  const revertButton = document.getElementById('revert-custom-theme-btn');
  const saveButton = document.getElementById('save-custom-theme-btn');
  const themeNameInput = document.getElementById('custom-theme-name');
  //  从 DOM 中读取值
  const elements = pageSettingsModal.querySelectorAll('input, select, textarea');

  // 应用主题按钮点击事件
  if (applyButton) {
    applyButton.addEventListener('click', async () => {
      //  从 DOM 中读取当前的自定义主题设置
      const themeData = {};
      elements.forEach(el => {
        if (el.type === 'checkbox') {
          themeData[el.id] = el.checked;
        } else if (el.type === 'radio') {
          if (el.checked) {
            themeData[el.name] = el.value;
          }
        } else if (el.id !== "custom-theme-name") {
          themeData[el.id] = el.value;
        }
      });

      //  应用自定义主题
      applyTheme(themeData);

      //  更新按钮状态
      applyButton.style.display = 'none';
      revertButton.style.display = 'inline-block';
    });
  }

  // 撤销应用按钮点击事件
  if (revertButton) {
    revertButton.addEventListener('click', async () => { // 【修改】这里也改成 async
      //  恢复到之前的 'default' 或已保存的自定义主题
      const savedTheme = (await settings.getSettings())['theme-select'] || 'default';//【修改】
      applyTheme(savedTheme);

      //  更新按钮状态
      revertButton.style.display = 'none';
      applyButton.style.display = 'inline-block';
    });
  }

  //保存主题 (与之前基本相同，只是移除了一些变量)
  if (saveButton && themeNameInput) {
    saveButton.addEventListener('click', async () => {
      const themeName = themeNameInput.value.trim();
      if (!themeName) {
        alert('Please enter a theme name.');
        return;
      }

      const themeData = {};
      elements.forEach(el => {
        if (el.type === 'checkbox') {
          themeData[el.id] = el.checked;
        } else if (el.type === 'radio') {
          if (el.checked) {
            themeData[el.name] = el.value;
          }
        } else if (el.id !== "custom-theme-name") {
          themeData[el.id] = el.value;
        }
      });

      try {
        await saveCustomTheme(themeName, themeData); //  传入主题名称和数据
        console.log(`Custom theme "${themeName}" saved.`);

        const themeSelect = document.getElementById('theme-select');
        const option = document.createElement('option');
        option.value = themeName;
        option.textContent = themeName;
        themeSelect.appendChild(option);

        themeSelect.value = themeName;
        applyTheme(themeName);

        applyButton.style.display = 'inline-block';
        revertButton.style.display = 'none';

      } catch (error) {
        console.error('Error saving custom theme:', error);
        alert('Error saving custom theme. See console for details.');
      }
    });
  }
}

async function deleteCustomTheme() {
  const themeSelect = document.getElementById('theme-select');
  if (!themeSelect) return;

  const themeToDelete = themeSelect.value;

  // 不能删除内置主题
  if (themeToDelete === 'default' || themeToDelete === 'dark') {
    alert('Cannot delete built-in themes.'); // 可以是更友好的提示
    return;
  }

  // 二次确认
  if (!confirm(`Are you sure you want to delete the theme "${themeToDelete}"?`)) {
    return;
  }

  try {
    // 1. 从 localStorage 中删除
    localStorage.removeItem(`customTheme:${themeToDelete}`);

    // 2. 更新 customThemes 列表 (localStorage)
    let customThemes = loadCustomThemes(); // 使用 style.js 里的函数
    delete customThemes[themeToDelete];
    localStorage.setItem('customThemes', JSON.stringify(customThemes));

    // 3. 从服务器删除 (可选, 如果你有服务器端的删除逻辑)
    // await deleteThemeFromServer(themeToDelete); // 你需要自己实现这个函数

    // 4. 更新主题下拉列表
    updateThemeSelect(); // 使用 style.js 里的函数

    // 5. 切换回默认主题 (或其他)
    applyTheme('default');

    console.log(`Custom theme "${themeToDelete}" deleted.`);
  } catch (error) {
    console.error('Error deleting custom theme:', error);
    alert('Error deleting custom theme. See console for details.'); // 给用户提示
  }
}

// 【新增】处理删除主题按钮的点击事件
function setupDeleteCustomThemeHandler() {
  const deleteButton = document.getElementById('delete-custom-theme-btn');
  if (deleteButton) {
    deleteButton.addEventListener('click', deleteCustomTheme);
  }
}
// 初始化
function initModalControls() {
  //setupModalOpenCloseHandlers(); // 【修改】在这里调用
  setupSystemSettingsHandlers();
  setupLanguageChangeHandler();
  setupPageSettingsHandlers();
  setupBackgroundFileHandler();
  setupBackgroundFitHandler();
  setupLayoutSwitchHandler();
  setupAutoOrientationHandler();
  setupMessageSend();
  setupThemeChangeHandler();
  setupSaveCustomThemeHandler(); //【新增】
  setupDeleteCustomThemeHandler()
}

export { initModalControls, openModal, closeModal, setupModalOpenCloseHandlers, };