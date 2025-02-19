// example/LLM_Role_Play/js/settings.js

import { connectToServer } from "./socket.js";
import * as log from './log.js';
import { showLoadingOverlay, hideLoadingOverlay } from "./main.js";
import { saveJsonToFile } from './save_file.js';

// 【修改】默认设置 (键名改为烤肉串命名法)
const defaultSettings = {
  'language-select': 'en',
  'server-address': 'ws://localhost:4000',
  'reconnect-attempts': 10,
  'reconnect-delay': 1000,
  timeout: 5000,
  'auto-connect': true,
  'socketio-path': '/socket.io',
  'query-parameters': {},
  transport: 'websocket'
};

let previousSettings = { ...defaultSettings }; // 保存之前的设置
let currentLanguageData = {}; // 当前加载的语言数据

//  扁平化对象的函数 (保持不变)
function flattenObject(obj, prefix = '') {
  // ... (与之前相同) ...
  let flatObject = {};

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const newKey = prefix ? `${prefix}.${key}` : key;

      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        // 递归调用，处理嵌套对象
        Object.assign(flatObject, flattenObject(obj[key], newKey));
      } else {
        // 将值添加到扁平化对象
        flatObject[newKey] = obj[key];
      }
    }
  }

  return flatObject;
}

// 加载语言文件
async function loadLanguageData(lang) {
  // ... (与之前相同) ...
  try {
    const timestamp = new Date().getTime();
    const response = await fetch(`resource/Language/${lang}.json?t=${timestamp}`);
    if (!response.ok) {
      throw new Error(`Failed to load language file: ${lang}.json`);
    }
    const nestedData = await response.json();
    currentLanguageData = flattenObject(nestedData);
    console.log('Loaded language data:', currentLanguageData);

    //  加载语言数据后立即更新 UI 文本
    updateUIText();

    return currentLanguageData;
  } catch (error) {
    console.error(error);
    if (lang !== 'en') {
      return await loadLanguageData('en'); // 如果加载失败，尝试加载英文
    }
    return null;
  }
}

//  将驼峰命名法转换为烤肉串命名法 (不再需要)
//function normalizeKey(key) {
//    return key.replace(/([A-Z])/g, '-$1').toLowerCase();
//}

// 从 localStorage 和 system_settings.json 加载设置
async function loadSettings() {
  // 1. 从 localStorage 加载设置 (优先级更高)
  for (const key in defaultSettings) {
    const storedValue = localStorage.getItem(key);
    if (storedValue !== null) {
      try {
        if (key === 'query-parameters') {
          defaultSettings[key] = storedValue ? JSON.parse(storedValue) : {};
        } else if (storedValue === "true" || storedValue === "false") {
          defaultSettings[key] = storedValue === "true";
        } else if (!isNaN(storedValue) && key !== 'socketio-path' && key !== 'server-address') {
          defaultSettings[key] = Number(storedValue);
        } else {
          defaultSettings[key] = storedValue; // 其他情况直接赋值
        }
      } catch (error) {
        console.error(`Error parsing stored value for key "${key}":`, error);
      }
    }
  }

  // 2. 从 system_settings.json 加载设置 (覆盖 localStorage 中没有的值)
  try {
    const response = await fetch('json/system_settings.json');
    if (response.ok) {
      const jsonData = await response.json();
      for (const key in jsonData) {
        //  直接使用 key (不再需要 normalizeKey)
        if (jsonData.hasOwnProperty(key) && localStorage.getItem(key) === null) {
          defaultSettings[key] = jsonData[key];
        }
      }
    } else {
      // 如果加载失败，可能文件不存在，使用默认值，并创建文件
      // saveSettings(); //【修改】这里不能直接调用 saveSettings()，因为 saveSettings() 会再次调用 loadSettings()，导致循环调用
      // 而是手动将 defaultSettings 保存到 localStorage
      for (const key in defaultSettings) {
        localStorage.setItem(key, typeof defaultSettings[key] === 'object' ? JSON.stringify(defaultSettings[key]) : defaultSettings[key]);
      }
    }
  } catch (error) {
    console.error('Error loading settings from JSON:', error);
  }

  // 3. 加载语言数据
  await loadLanguageData(defaultSettings["language-select"]);

  previousSettings = { ...defaultSettings }; // 更新 previousSettings
}

// 防抖函数
function debounce(func, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}

// 保存设置到 localStorage 和 system_settings.json (接收 data 参数)
const saveSettings = debounce(async (data) => {
  showLoadingOverlay();

  // 1. 使用传入的 data 对象更新 defaultSettings
  if (data) {
    for (const key in data) {
      //  直接使用 key (不再需要 normalizeKey)
      if (defaultSettings.hasOwnProperty(key)) {
        defaultSettings[key] = data[key];
      }
    }
  }

  // 2. 保存到 localStorage
  for (const key in defaultSettings) {
    let valueToStore = defaultSettings[key];
    if (key === 'query-parameters') {
      valueToStore = JSON.stringify(valueToStore);
    }
    localStorage.setItem(key, valueToStore);
  }

  // 3. 保存到 system_settings.json
  try {
    //  直接保存 defaultSettings (不再需要转换键名)
    await saveJsonToFile('json/system_settings.json', defaultSettings);
    log.addLogMessage("success", "保存设置成功！", 'client');

    // 4. 比较设置是否改变 (在保存到 JSON 之后)
    const settingsChanged = Object.keys(defaultSettings).some(key => {
      //  直接比较 (不再需要特殊处理)
      if (key === 'query-parameters') {
        return JSON.stringify(defaultSettings[key]) !== JSON.stringify(previousSettings[key]);
      }
      return defaultSettings[key] !== previousSettings[key]
    });
    if (settingsChanged) {
      previousSettings = { ...defaultSettings }; // 更新 previousSettings
      connectToServer(); // 重新连接
    }

  } catch (error) {
    console.error('Error saving settings to JSON:', error);
    log.addLogMessage("fail", "保存设置失败！", 'client');
  } finally {
    hideLoadingOverlay();
  }
}, 300);

// 【修改】应用设置 (接收 data 参数，根据 data.language 重新加载语言)
async function applySettings(data) {
  const language = data && data['language-select'] ? data['language-select'] : defaultSettings['language-select'];
  console.log(`Applying language: ${language}`);
  await loadLanguageData(language);
}

// 更新 UI 文本
function updateUIText() {
  // ... (与之前相同) ...
  //console.log('Current language data:', currentLanguageData); // 调试

  //  获取完整键名的函数
  function getFullKey(element, key) {
    let prefix = '';
    const modal = element.closest('.modal');

    if (modal) {
      // 从 modal 的 id 推断出前缀 (例如, system-settings-modal -> system_settings_modal)
      //prefix = modal.id.replace(/-modal$/, '').replace(/-/g, '_') + '.';
      //console.log("prefix:", prefix);
    } else if (element.closest('header')) {
      prefix = 'header.';
    } else if (element.closest('footer')) {
      prefix = 'footer.';
    }
    return prefix + key;
  }


  // 更新文本内容
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(element => {
    const key = element.dataset.i18n;
    const fullKey = getFullKey(element, key);
    //  直接从扁平化的 currentLanguageData 中获取值
    if (currentLanguageData[fullKey]) {
      //console.log(`Setting text for ${fullKey}: ${currentLanguageData[fullKey]}`);
      element.textContent = currentLanguageData[fullKey];
    } else {
      console.log(`Setting text for ${fullKey} is fail: ${currentLanguageData[fullKey]}`);
      console.warn(`No translation found for key: ${fullKey}`, element); //  调试信息
    }
  });

  //更新占位符
  const placeholderElements = document.querySelectorAll('[data-i18n-placeholder]');
  placeholderElements.forEach(element => {
    const key = element.dataset.i18nPlaceholder;
    const fullKey = getFullKey(element, key);
    //  直接从扁平化的 currentLanguageData 中获取值
    if (currentLanguageData[fullKey]) {
      //console.log(`Setting placeholder for ${fullKey}: ${currentLanguageData[fullKey]}`); //调试
      element.placeholder = currentLanguageData[fullKey];
    } else {
      console.warn(`No placeholder translation found for key: ${fullKey}`, element); //  调试信息
    }
  });

  //  更新 title 属性
  const titleElements = document.querySelectorAll('[data-i18n-title]');
  titleElements.forEach(element => {
    const key = element.dataset.i18nTitle;
    const fullKey = getFullKey(element, key);
    //  直接从扁平化的 currentLanguageData 中获取值
    if (currentLanguageData[fullKey]) {
      //console.log(`Setting title for ${fullKey}: ${currentLanguageData[fullKey]}`); //  调试
      element.title = currentLanguageData[fullKey];
    } else {
      console.warn(`No title translation found for key: ${fullKey}`, element); //  调试信息
    }
  });
}
// 获取所有设置
function getSettings() {
  return { ...defaultSettings }; // 返回一个副本, 防止外部修改
}

export { loadSettings, saveSettings, applySettings, getSettings, loadLanguageData, updateUIText };