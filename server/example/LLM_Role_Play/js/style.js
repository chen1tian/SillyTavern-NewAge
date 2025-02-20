// example/LLM_Role_Play/js/style.js

import { saveJsonToFile } from "./save_file.js"
import { initColorInputs } from './ui.js'

// 默认主题 (柔和)
const defaultTheme = {
  colors: {
    headerBg: '#5e81ac',       // 柔和的蓝灰色 (Header 背景)
    headerText: '#ffffff',     // 白色 (Header 文字)
    buttonColor: '#88c0d0',    // 浅蓝色 (按钮颜色)
    mainBg: '#eceff4',         // 浅灰白色 (Main 背景)
    mainText: '#2e3440',       // 深灰 (Main 文字)
    footerBg: '#e5e9f0',       // 浅灰色 (Footer 背景)
    footerText: '#4c566a',     // 灰蓝色 (Footer 文字)
    containerBg: '#ffffff',   // 白色 (Container 背景)
    doubleQuote: '#a3be8c',    // 柔和的绿色 (双引号)
    singleQuote: '#81a1c1',    // 柔和的蓝色 (单引号)
  },
  frostedGlass: { // 新增：毛玻璃效果
    enabled: false, // 是否启用
    bgOnly: false,  // 是否仅模糊背景图
    opacity: 0.8,   // 不透明度 (0-1)
    blur: 10,       // 模糊半径 (px)
  },
  fonts: {
    main: 'Roboto, sans-serif',
  },
};

// 暗黑主题 (柔和)
const darkTheme = {
  colors: {
    headerBg: '#4c566a',       // 深灰蓝色 (Header 背景)
    headerText: '#ffffff',     // 白色 (Header 文字)
    buttonColor: '#5e81ac',    // 蓝灰色 (按钮颜色)
    mainBg: '#2e3440',         // 深灰 (Main 背景)
    mainText: '#eceff4',       // 浅灰白色 (Main 文字)
    footerBg: '#3b4252',       // 稍浅的深灰 (Footer 背景)
    footerText: '#d8dee9',     // 浅灰色 (Footer 文字)
    containerBg: '#434c5e',   // 灰蓝色 (Container 背景)
    doubleQuote: '#a3be8c',    // 柔和的绿色 (双引号)
    singleQuote: '#81a1c1',    // 柔和的蓝色 (单引号)
  },
  frostedGlass: { // 新增：毛玻璃效果
    enabled: false,
    bgOnly: false,
    opacity: 0.7,
    blur: 12,
  },
  fonts: {
    main: 'Roboto, sans-serif',
  },
};
//辅助函数
const isValidTheme = (theme) => {
  return typeof theme === 'object' && theme !== null &&
    typeof theme.colors === 'object' &&
    typeof theme.colors['header-bg-color'] === 'string' &&
    typeof theme.colors['main-bg-color'] === 'string' &&
    typeof theme.frostedGlass === 'object' && // 新增
    typeof theme.frostedGlass.enabled === 'boolean' && // 新增
    typeof theme.frostedGlass.opacity === 'number' &&   // 新增
    typeof theme.frostedGlass.blur === 'number';      // 新增
};
// 【修改】获取主题对象 (根据主题标识符)
async function getThemeObject(themeIdentifier) {
  if (themeIdentifier === 'default') {
    return defaultTheme;
  } else if (themeIdentifier === 'dark') {
    return darkTheme;
  } else if (typeof themeIdentifier === 'object' && themeIdentifier !== null) {
    //  如果传入的是一个对象，则直接使用该对象
    return themeIdentifier;
  } else {
    // 尝试加载自定义主题
    try {
      //优先读取localStorage
      const storedTheme = localStorage.getItem(`customTheme:${themeIdentifier}`);
      if (storedTheme) {
        const customTheme = JSON.parse(storedTheme);
        if (isValidTheme(customTheme)) { // 假设这是你检查主题格式的函数
          console.warn(`Custom theme "${themeIdentifier}" has invalid format. Using default theme.`);
          return defaultTheme; //  格式不正确, 返回默认
        }
        return customTheme;
      }
      const response = await fetch(`../../resource/css/${themeIdentifier}.json`); //【修改】
      if (response.ok) {
        const customTheme = await response.json();
        if (isValidTheme(customTheme)) { // 假设这是你检查主题格式的函数
          console.warn(`Custom theme "${themeIdentifier}" has invalid format. Using default theme.`);
          return defaultTheme; //  格式不正确, 返回默认
        }
        return customTheme; // 【修改】
      } else {
        console.warn(`Custom theme "${themeIdentifier}" not found. Using default theme.`);
        return defaultTheme; //  回退到默认主题
      }
    } catch (error) {
      console.warn(`Custom theme "${themeIdentifier}" not found. Using default theme.`);
      return defaultTheme; //  回退到默认主题
    }
  }
}

// 【修改】生成全局样式字符串的函数
const generateGlobalStyles = (theme) => {
  //【新增】毛玻璃效果
const frostedGlassStyles = `
    .frosted-glass {
        background-color: rgba(255, 255, 255, var(--frosted-glass-opacity, ${theme.frostedGlass.opacity})); /* 半透明白色背景 */
        backdrop-filter: blur(var(--frosted-glass-blur, ${theme.frostedGlass.blur}px)); /* 模糊背景 */
        -webkit-backdrop-filter: blur(var(--frosted-glass-blur, ${theme.frostedGlass.blur}px)); /* 兼容性 */
    }

    /* 仅对背景图应用毛玻璃效果 */
    .frosted-glass-bg {
        position: relative; /* 确保 ::before 伪元素相对于此元素定位 */
    }

    .frosted-glass-bg::before {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: -1; /* 将伪元素放在背景图下方 */
        background: inherit; /* 继承 body 的背景 */
        filter: blur(var(--frosted-glass-blur, ${theme.frostedGlass.blur}px)); /* 模糊背景 */
        -webkit-filter: blur(var(--frosted-glass-blur, ${theme.frostedGlass.blur}px));
        margin: -20px; /* 扩大模糊区域，避免边缘出现清晰的边界 */
    }
    `

return `
  :root {
      --header-bg-color: ${theme.colors.headerBg};
      --header-font-color: ${theme.colors.headerText};
      --button-color: ${theme.colors.buttonColor};
      --main-bg-color: ${theme.colors.mainBg};
      --main-font-color: ${theme.colors.mainText};
      --footer-bg-color: ${theme.colors.footerBg};
      --footer-font-color: ${theme.colors.footerText};
      --container-bg-color: ${theme.colors.containerBg};
      --double-quote-color: ${theme.colors.doubleQuote};
      --single-quote-color: ${theme.colors.singleQuote};
  }

  body {
      font-family: ${theme.fonts.main}, sans-serif;
      margin: 0;
      padding: 0;
      background-color: var(--main-bg-color);
      color: var(--main-font-color);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
  }

  /* ... 其他全局样式 ... */
    *, *::before, *::after {
      box-sizing: border-box;
  }
  h1, h2, h3, h4, h5, h6 {
      margin: 0; /* 移除标题的默认外边距 */
  }
  header .button-group button{
    background-color: var(--button-color);
    color: var(--header-font-color);
  }
  /* 添加自定义滚动条样式 */
  ::-webkit-scrollbar {
      width: 8px; /* 滚动条宽度 */
  }

  ::-webkit-scrollbar-track {
      background: #f1f1f1; /* 滚动条轨道颜色 */
      border-radius: 4px; /* 圆角 */
  }

  ::-webkit-scrollbar-thumb {
      background: #888; /* 滚动条滑块颜色 */
      border-radius: 4px; /* 圆角 */
  }

  ::-webkit-scrollbar-thumb:hover {
      background: #555; /* 悬停时滑块颜色 */
  }
    ${frostedGlassStyles} /*【新增】把毛玻璃效果放在这里, 这样就不用重复写了*/

`;
};

// 【新增】 强制应用当前主题颜色到 HTML 元素
function applyCurrentThemeColors() {
  requestAnimationFrame(() => { // 使用 requestAnimationFrame
    const computedStyle = getComputedStyle(document.documentElement);

    // 缓存元素
    const header = document.querySelector('header');
    const buttons = document.querySelectorAll('header .button-group button');
    const main = document.querySelector('main');
    const footer = document.querySelector('footer');
    const container = document.querySelector('.container');

    // 批量更新样式
    const styles = {};

    if (header) {
      styles.header = {
        backgroundColor: computedStyle.getPropertyValue('--header-bg-color').trim(),
        color: computedStyle.getPropertyValue('--header-font-color').trim(),
      };
    }
    if (buttons.length > 0) { // 检查 buttons 是否存在
        styles.buttons = {
            backgroundColor: computedStyle.getPropertyValue('--button-color').trim(),
            color: computedStyle.getPropertyValue('--header-font-color').trim(),
        };
    }
    if (main) {
      styles.main = {
        backgroundColor: computedStyle.getPropertyValue('--main-bg-color').trim(),
        color: computedStyle.getPropertyValue('--main-font-color').trim(),
      };
    }
    if (footer) {
      styles.footer = {
        backgroundColor: computedStyle.getPropertyValue('--footer-bg-color').trim(),
        color: computedStyle.getPropertyValue('--footer-font-color').trim(),
      };
    }
    if (container) {
      styles.container = {
        backgroundColor: computedStyle.getPropertyValue('--container-bg-color').trim(),
      };
    }

    // 一次性应用样式
    if (styles.header) {
      Object.assign(header.style, styles.header);
    }
    if (styles.buttons) { // 检查 styles.buttons 是否存在
        buttons.forEach(button => Object.assign(button.style, styles.buttons));
    }
    if (styles.main) {
      Object.assign(main.style, styles.main);
    }
    if (styles.footer) {
      Object.assign(footer.style, styles.footer);
    }
    if (styles.container) {
      Object.assign(container.style, styles.container);
    }
      //【新增】 应用毛玻璃效果
    applyFrostedGlass();
  });
}

// 【新增】 应用毛玻璃效果 (根据设置)
async function applyFrostedGlass() {
  const frostedGlassEnabledInput = document.getElementById('frosted-glass-enabled');
  const frostedGlassBgOnlyInput = document.getElementById('frosted-glass-bg-only');
  const frostedGlassOpacityInput = document.getElementById('frosted-glass-opacity');
  const frostedGlassBlurInput = document.getElementById('frosted-glass-blur');
  // 移除之前的毛玻璃样式类
  document.body.classList.remove('frosted-glass', 'frosted-glass-bg');
  const frostedGlassEnabled = frostedGlassEnabledInput.checked;
  const frostedGlassBgOnly = frostedGlassBgOnlyInput.checked;
  const opacity = parseFloat(frostedGlassOpacityInput.value);       // 使用滑块的值
  const blur = parseInt(frostedGlassBlurInput.value);

  if (frostedGlassEnabled) {
    if (frostedGlassBgOnly) {
      document.body.classList.add('frosted-glass-bg');
        document.documentElement.style.setProperty('--frosted-glass-opacity', opacity);
        document.documentElement.style.setProperty('--frosted-glass-blur', `${blur}px`);
    } else {
      document.body.classList.add('frosted-glass');
        document.documentElement.style.setProperty('--frosted-glass-opacity', opacity);
        document.documentElement.style.setProperty('--frosted-glass-blur', `${blur}px`);
    }
  }
}

// 【新增】应用主题 (根据主题名称)
async function applyTheme(themeName) {
  const theme = await getThemeObject(themeName);
  const cssText = generateGlobalStyles(theme);
  const existingStyle = document.getElementById('theme-style');
  if (existingStyle) {
    existingStyle.remove();
  }
  const styleElement = document.createElement('style');
  styleElement.id = 'theme-style';
  styleElement.textContent = cssText;
  document.head.appendChild(styleElement);
  //【修改】这里不再需要保存 selectedTheme，因为 setupThemeChangeHandler 已经做了
   await initColorInputs(); // 【新增】在应用主题后，初始化颜色 input 的值

   applyCurrentThemeColors();
}

// 【新增】应用自定义 CSS
function applyCustomCSS(cssCode) {
  let styleElement = document.getElementById('custom-css');

  // 如果 style 标签不存在，则创建一个
  if (!styleElement) {
    styleElement = document.createElement('style');
    styleElement.id = 'custom-css'; // 添加 ID，以便稍后移除或更新
    document.head.appendChild(styleElement);
  }
  //【重要】 过滤和转义

  //  更新 style 标签的内容
  styleElement.textContent = cssCode;
}

// 【新增】保存自定义主题
async function saveCustomTheme(themeName, themeData) {
  try {
    const themeToSave = {
      colors: {
        headerBg: themeData['header-bg-color'],
        headerText: themeData['header-font-color'],
        buttonColor: themeData['button-color'],
        mainBg: themeData['main-bg-color'],
        mainText: themeData['main-font-color'],
        footerBg: themeData['footer-bg-color'],
        footerText: themeData['footer-font-color'],
        containerBg: themeData['container-bg-color'],
        doubleQuote: themeData['double-quote-color'],
        singleQuote: themeData['single-quote-color'],
      },
      frostedGlass: { // 新增：保存毛玻璃效果设置
        enabled: themeData['frosted-glass-enabled'],
        bgOnly: themeData['frosted-glass-bg-only'],  //是否仅模糊背景图
        opacity: parseFloat(themeData['frosted-glass-opacity'] || 0.8), // 使用传入的值，或默认值
        blur: parseInt(themeData['frosted-glass-blur'] || 10),        // 使用传入的值，或默认值
      },
      fonts: {
        main: 'Segoe UI',
      },
    };

    localStorage.setItem(`customTheme:${themeName}`, JSON.stringify(themeToSave));

    let customThemes = {};
    const customThemesStr = localStorage.getItem('customThemes');
    if (customThemesStr) {
      customThemes = JSON.parse(customThemesStr);
    }
    customThemes[themeName] = themeName;
    localStorage.setItem('customThemes', JSON.stringify(customThemes));

    await saveJsonToFile(`resource/css/${themeName}.json`, themeToSave);

    const response = await fetch('resource/css/custom_theme.json');
    let customThemesServer = {};
    if (response.ok) {
      customThemesServer = await response.json();
    }
    customThemesServer[themeName] = themeName;
    await saveJsonToFile('resource/css/custom_theme.json', customThemesServer);

    updateThemeSelect();

  } catch (error) {
    throw error;
  }
}

// 从 localStorage 加载所有自定义主题
function loadCustomThemes() {
  let customThemes = {};
  const customThemesStr = localStorage.getItem('customThemes');
  if (customThemesStr) {
    customThemes = JSON.parse(customThemesStr);
  }
  return customThemes;
}

// 【新增】更新主题选择下拉列表
function updateThemeSelect() {
  const themeSelect = document.getElementById('theme-select');
  if (!themeSelect) return;

  //  清除现有选项 (除了 'default' 和 'dark')
  const optionsToRemove = [];
  for (let i = 0; i < themeSelect.options.length; i++) {
    const option = themeSelect.options[i];
    if (option.value !== 'default' && option.value !== 'dark') {
      optionsToRemove.push(option);
    }
  }
  optionsToRemove.forEach(option => option.remove());

  //  从 localStorage 加载自定义主题
  const customThemes = loadCustomThemes();

  //  添加自定义主题选项
  for (const themeName in customThemes) {
    const option = document.createElement('option');
    option.value = themeName;
    option.textContent = themeName;
    themeSelect.appendChild(option);
  }
  //选中当前
  const currentTheme = localStorage.getItem('selectedTheme') || 'default'; // 【新增】
  themeSelect.value = currentTheme;
}

//调试模式
// 【新增】 大字符图案相关
let bigCharDiv = null; // 用于保存大字符图案元素的引用

function createBigCharacter() {
  if (bigCharDiv) return;

  bigCharDiv = document.createElement('div');
  bigCharDiv.id = 'big-character';
  bigCharDiv.textContent = '大'; //  你可以改成任何你想要的字符
  bigCharDiv.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 200px; /* 根据需要调整 */
    color: rgba(0, 0, 0, 0.1); /* 半透明 */
    z-index: 1; /* 在 container 下方，loading-overlay 上方 */
    pointer-events: none; /* 不响应鼠标事件 */
    user-select: none; /* 不可选中 */
  `;
  // 【修改】 插入位置
  document.body.insertBefore(bigCharDiv, document.getElementById('loading-overlay'));
}

function removeBigCharacter() {
  if (!bigCharDiv) return; // 如果不存在，则直接返回
  bigCharDiv.remove();
  bigCharDiv = null;
}

// 【修改】 切换大字符图案的显示/隐藏 (不再依赖 bgFit)
function toggleBigCharacter() {
  if (bigCharDiv) {
    removeBigCharacter();
  } else {
    createBigCharacter();
  }
}
// 【新增】在 debug 模态框中切换大字符图案的显示/隐藏
function setupBigCharacterToggle() {
  const toggleButton = document.getElementById('toggle-big-char-btn');
  if (toggleButton) {
    toggleButton.addEventListener('click', toggleBigCharacter);
  }
}

// 导出
export {
  defaultTheme, darkTheme, applyTheme, applyCustomCSS, saveCustomTheme, updateThemeSelect, loadCustomThemes, getThemeObject, applyCurrentThemeColors,setupBigCharacterToggle,applyFrostedGlass
};