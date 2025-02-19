// example/LLM_Role_Play/js/style.js

import { saveJsonToFile } from "./save_file.js"

// 默认主题
const defaultTheme = {
  colors: {
    headerBg: '#3498db',
    headerText: '#ffffff',
    mainBg: '#f0f0f0',
    mainText: '#333333',
    footerBg: '#ffffff',
    footerText: '#000000',
    containerBg: '#ffffff',
    buttonGroupBg: '#ffffff',
    doubleQuote: '#008000', // 新增：双引号颜色
    singleQuote: '#0000ff', // 新增：单引号颜色
  },
  fonts: {
    main: 'Segoe UI',
  },
  // 可以在这里添加更多主题相关的属性，例如间距、边框半径等
};

// 暗黑主题 (示例)
const darkTheme = {
  colors: {
    headerBg: '#1e1e1e',
    headerText: '#ffffff',
    mainBg: '#282828',
    mainText: '#dddddd',
    footerBg: '#1e1e1e',
    footerText: '#ffffff',
    containerBg: '#333333',
    buttonGroupBg: '#444444',
    doubleQuote: '#90ee90', // 新增：双引号颜色 (浅绿色)
    singleQuote: '#add8e6', // 新增：单引号颜色 (浅蓝色)
  },
  fonts: {
    main: 'Segoe UI',
  },
};
//辅助函数
const isValidTheme = (theme) => {
  return typeof theme === 'object' && theme !== null &&
    typeof theme['header-bg-color'] === 'string' &&  // 检查关键属性
    typeof theme['main-bg-color'] === 'string'; //可以再多检查几个
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
  
  return `
    :root {
        --header-bg-color: ${theme.colors.headerBg};
        --header-font-color: ${theme.colors.headerText};
        --main-bg-color: ${theme.colors.mainBg};
        --main-font-color: ${theme.colors.mainText};
        --footer-bg-color: ${theme.colors.footerBg};
        --footer-font-color: ${theme.colors.footerText};
        --container-bg-color: ${theme.colors.containerBg};
        --button-group-bg-color: ${theme.colors.buttonGroupBg};
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
    /* 毛玻璃效果 */
    .frosted-glass {
        background-color: rgba(255, 255, 255, 0.8); /* 半透明白色背景 */
        backdrop-filter: blur(10px); /* 模糊背景 */
        -webkit-backdrop-filter: blur(10px); /* 兼容性 */
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
        filter: blur(10px); /* 模糊背景 */
        -webkit-filter: blur(10px);
        margin: -20px; /* 扩大模糊区域，避免边缘出现清晰的边界 */
    }
`;
};

// 【新增】应用主题 (根据主题名称)
async function applyTheme(themeName) {
  console.log(`applyTheme called with: ${themeName}`); // 调试
  const theme = await getThemeObject(themeName); // 获取主题对象, 注意, 这里包含了自定义主题
  console.log("theme:", theme);
  const cssText = generateGlobalStyles(theme);  // 生成 CSS 字符串
  console.log("cssText:", cssText);
  //  移除之前的主题样式 (如果有)
  const existingStyle = document.getElementById('theme-style');
  console.log("existingStyle:", existingStyle);
  if (existingStyle) {
    existingStyle.remove();
  }

  //  创建新的 <style> 标签
  const styleElement = document.createElement('style');
  styleElement.id = 'theme-style'; //  给 <style> 标签添加 ID，以便稍后移除
  styleElement.textContent = cssText;
  document.head.appendChild(styleElement); //  添加到 <head>
  console.log("document.head:", document.head);
  void document.body.offsetWidth;
  // 【新增】保存当前选择的主题
  localStorage.setItem('selectedTheme', themeName);
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
    // 1. 将 themeData 转换为与 defaultTheme 结构一致的对象
    const themeToSave = {
      colors: {
        headerBg: themeData['header-bg-color'],
        headerText: themeData['header-font-color'],
        mainBg: themeData['main-bg-color'],
        mainText: themeData['main-font-color'],
        footerBg: themeData['footer-bg-color'],
        footerText: themeData['footer-font-color'],
        containerBg: themeData['container-bg-color'],
        buttonGroupBg: themeData['button-group-bg-color'],
        doubleQuote: themeData['double-quote-color'], // 新增
        singleQuote: themeData['single-quote-color'], // 新增
      },
      fonts: {
        main: 'Segoe UI', // 这里可以根据需要添加字体设置
      },
    };

    // 2. 保存到 localStorage
    localStorage.setItem(`customTheme:${themeName}`, JSON.stringify(themeToSave));

    // 3. 更新 customThemes 列表 (也保存在 localStorage)
    let customThemes = {};
    const customThemesStr = localStorage.getItem('customThemes');
    if (customThemesStr) {
      customThemes = JSON.parse(customThemesStr);
    }
    customThemes[themeName] = themeName; // 或者你可以存储任何与主题相关的信息
    localStorage.setItem('customThemes', JSON.stringify(customThemes));

    // 4. 通过服务器保存 (你的 saveJsonToFile 函数)
    await saveJsonToFile(`resource/css/${themeName}.json`, themeToSave);

    // 5. 更新 custom_theme.json (用于服务器端)
    const response = await fetch('resource/css/custom_theme.json');
    let customThemesServer = {};
    if (response.ok) {
      customThemesServer = await response.json();
    }
    customThemesServer[themeName] = themeName; //  你可以存储任何与主题相关的信息
    await saveJsonToFile('resource/css/custom_theme.json', customThemesServer);

    // 6. 更新主题下拉列表
    updateThemeSelect();

  } catch (error) {
    throw error; // 向上传播
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

// 导出
export {
  defaultTheme, darkTheme, applyTheme, applyCustomCSS, saveCustomTheme, updateThemeSelect, loadCustomThemes
};