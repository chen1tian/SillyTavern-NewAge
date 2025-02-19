// server/dist/function_call.js

import fs from 'fs/promises'; // 使用 promises 版本的 fs 模块
// 【修改】导入 path 模块
import { dirname, join, isAbsolute, normalize, sep } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let absoluteFilePath = ''

async function saveJsonToFile(filePath, jsonData) {
  try {
    // 【新增】路径处理逻辑
    absoluteFilePath = filePath;
    if (!isAbsolute(filePath)) {
      //  如果 filePath 是相对路径，则转换为绝对路径
      // __dirname:  server/dist
      // 我们要的是 server/
      const projectRoot = join(__dirname, '..');  // server 目录
      absoluteFilePath = join(projectRoot, filePath);
    }

    //规范化
    absoluteFilePath = normalize(absoluteFilePath);
    console.log("absoluteFilePath:", absoluteFilePath);
    //  基本安全检查：防止路径遍历攻击
    //if (absoluteFilePath.indexOf('..') !== -1 || absoluteFilePath.indexOf(':') !== -1 || absoluteFilePath.indexOf('\0') !== -1) {
    //  throw new Error('Invalid file path');
    //}

    const dir = dirname(absoluteFilePath); // 获取文件所在的目录

    // 确保目录存在, 不存在就创建
    await fs.mkdir(dir, { recursive: true });


    // 写入文件 (使用 writeFile，它会覆盖现有文件)
    await fs.writeFile(absoluteFilePath, JSON.stringify(jsonData, null, 2), 'utf8');
    console.log(`JSON data saved to: ${absoluteFilePath}`);
    return { success: true }; // 返回成功

  } catch (error) {
    console.error(`Error saving JSON to file (${absoluteFilePath}):`, error);
    return { success: false, error: error.message }; // 返回失败，并包含错误信息
  }
}
export { saveJsonToFile };