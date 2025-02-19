// example/LLM_Role_Play/js/pageSettings.js

import { showLoadingOverlay, hideLoadingOverlay } from "./main.js";
//import { applyPageSettings } from "./ui.js"; // 【修改】不再需要导入 applyPageSettings
//  导入 saveJsonToFile
import { saveJsonToFile } from './save_file.js';

//  默认页面设置 (键名改为烤肉串命名法)
const defaultPageSettings = {
  'theme-select': 'default',
  //'custom-theme': '', // 【移除】不再需要
  //'bg-input': '', // 【移除】不再需要
  //  新增
  //'header-bg-color': '#ffffff',
  //'header-font-color': '#000000',
  //'main-bg-color': '#f0f0f0',
  //'main-font-color': '#333333',
  //'footer-bg-color': '#ffffff',
  //'footer-font-color': '#000000',
  //'container-bg-color': '#ffffff',
  //'button-group-bg-color': '#ffffff',
  //'font-input':'', // 【移除】不再需要
  //
  //'bg-fit-select': 'cover',
  //'layout-switch': true,
  //'auto-orientation': false,
  //'frosted-glass-enabled': false, //  毛玻璃效果
  //'frosted-glass-bg-only': false, //  仅模糊背景图
};

// 从 localStorage 和 page_settings.json 加载页面设置
async function loadPageSettings() {
  // ... (与之前相同) ...
  // 1. 从 localStorage 加载 (优先级更高)
  for (const key in defaultPageSettings) {
    const storedValue = localStorage.getItem(key);
    if (storedValue !== null) {
      try {
        if (storedValue === "true" || storedValue === "false") {
          defaultPageSettings[key] = storedValue === "true";
        } else {
          defaultPageSettings[key] = storedValue;
        }
      } catch (error) {
        console.error(`Error parsing stored value for key "${key}":`, error);
      }
    }
  }

  // 2. 从 page_settings.json 加载 (覆盖 localStorage 中没有的值)
  try {
    const response = await fetch('json/page_settings.json');
    if (response.ok) {
      const jsonData = await response.json();
      for (const key in jsonData) {
        if (jsonData.hasOwnProperty(key) && localStorage.getItem(key) === null) {
          defaultPageSettings[key] = jsonData[key];
        }
      }
    } else {
      // 如果加载失败，可能文件不存在，就使用默认值，并创建文件
      // savePageSettings(); //【修改】不能直接调用，会导致循环, 而是手动赋值
      for (const key in defaultPageSettings) {
        localStorage.setItem(key, typeof defaultPageSettings[key] === 'object' ? JSON.stringify(defaultPageSettings[key]) : defaultPageSettings[key]);
      }
    }
  } catch (error) {
    console.error('Error loading page settings from JSON:', error);
  }
}

// 保存页面设置到 localStorage 和 page_settings.json (接收 data 参数)
const savePageSettings = async (data) => {
  showLoadingOverlay();

  // 1. 使用传入的 data 对象更新 defaultPageSettings
  if (data) {
    for (const key in data) {
      //  直接使用 key (不再需要 normalizeKey)
      if (defaultPageSettings.hasOwnProperty(key)) {
        defaultPageSettings[key] = data[key];
      }
    }
  }

  // 2. 保存到 localStorage
  for (const key in defaultPageSettings) {
    localStorage.setItem(key, defaultPageSettings[key]);
  }

  // 3. 保存到 page_settings.json
  try {
    //  直接保存 defaultPageSettings (不再需要转换键名)
    await saveJsonToFile('json/page_settings.json', defaultPageSettings);
  } catch (error) {
    console.error('Error saving page settings to JSON:', error);
  } finally {
    hideLoadingOverlay();
    //applyPageSettings(); // 【修改】不再需要在这里调用 applyPageSettings
  }
};
function getPageSettings() {
  return { ...defaultPageSettings };
}

export { loadPageSettings, savePageSettings, getPageSettings };