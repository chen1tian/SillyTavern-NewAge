// server/dist/function_call.js

import fs from 'fs/promises'; // 使用 promises 版本的 fs 模块
import mime from 'mime-types'; // 用于获取 MIME 类型
import express from 'express';
import path,{ dirname, join, isAbsolute, normalize, sep, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const serverRoot = join(__dirname, '..'); // 定义 server 文件夹的绝对路径

const app = express();

let absoluteFilePath = '';

const staticAssets = new Map(); // 用 Map 存储静态资源 { urlPath: { content, contentType } }

// ❗❗❗ 定义不可操作的文件列表 (相对于 server 文件夹)
const restrictedFiles = [
  'dist/function_call.js', // 禁止操作自身
  //'settings/server_settings.json', //根据需求决定是否禁止修改
  // ... 其他你想要禁止访问的文件 ...
];

/**
 * 路径安全检查函数
 * @param {string} filePath - 用户提供的文件路径
 * @param {boolean} isRestrictedFiles - 是否使用restrictedFiles以禁止操作指定文件
 * @returns {string} - 规范化后的绝对路径
 * @throws {Error} - 如果路径无效或越界，则抛出错误
 */
function sanitizePath(filePath, isRestrictedFiles = true) {
  let absoluteFilePath = filePath;

  // 1. 转换为绝对路径
  if (!isAbsolute(filePath)) {
    absoluteFilePath = join(serverRoot, filePath);
    //console.log('isAbsolute(filePath):', isAbsolute(filePath));
  }

  // 2. 规范化路径
  absoluteFilePath = normalize(absoluteFilePath);

  //console.log('filePath:', absoluteFilePath);
  //console.log('serverRoot:', serverRoot);

  // 3. 越界检查 (检查是否超出 serverRoot)
  const serverRootParts = serverRoot.split(sep);
  const filePathParts = absoluteFilePath.split(sep);

  // 比较路径的每一部分，直到 serverRoot 的末尾
  for (let i = 0; i < serverRootParts.length; i++) {
    if (filePathParts[i] !== serverRootParts[i]) {
      console.log('serverRootParts:', serverRootParts);
      console.log('filePathParts:', filePathParts);
      throw new Error('Access denied: Path is outside the server directory.');
    }
  }

  // 4. 检查是否在受限文件列表中
  const relativePath = relative(serverRoot, absoluteFilePath);
  if (restrictedFiles.includes(relativePath) && isRestrictedFiles === true) {
    throw new Error('Access denied: File is restricted.');
  }

  return absoluteFilePath;
}

// 动态添加静态资源的函数 (内存操作)
async function addStaticResources(app, resources) {
  for (const urlPath in resources) {
    if (resources.hasOwnProperty(urlPath)) {
      const relativeFilePath = resources[urlPath];

      // 路径安全检查
      try {
        sanitizePath(relativeFilePath, false);
      } catch (error) {
        console.error(error.message);
        return { error: error.message };
        //throw new Error(`Invalid relative path: ${relativeFilePath}`);
      }

      const filePath = path.join(__dirname, '..', relativeFilePath);

      app.use(urlPath, express.static(filePath));
      console.log(`Added static resource route: ${urlPath} -> ${filePath}`);
      return { result: 'success' };
    }
  }
}

async function saveJsonToFile(filePath, jsonData) {
  let absoluteFilePath; // 声明在 try 块之外
  try {
    // ❗ 使用 sanitizePath 进行路径检查
    absoluteFilePath = sanitizePath(filePath);

    const dir = dirname(absoluteFilePath);

    // 确保目录存在
    await fs.mkdir(dir, { recursive: true });

    let existingData = {}; // 初始化为空对象

    // 尝试读取现有文件
    try {
      const fileContent = await fs.readFile(absoluteFilePath, 'utf8');
      existingData = JSON.parse(fileContent);
    } catch (readError) {
      // 如果文件不存在或读取失败（例如，不是有效的 JSON），则忽略错误，继续使用空的 existingData
      if (readError.code !== 'ENOENT') {
        // ENOENT 表示文件不存在
        console.error(`Error reading existing JSON file (${absoluteFilePath}):`, readError);
        //throw readError; //读取失败时，不应该阻止写入
      }
    }

    // 合并现有数据和新数据 (新数据覆盖旧数据)
    const updatedData = { ...existingData, ...jsonData };

    // 写入更新后的数据
    await fs.writeFile(absoluteFilePath, JSON.stringify(updatedData, null, 2), 'utf8');
    console.log(`JSON data updated in: ${absoluteFilePath}`);
    return { success: true };
  } catch (error) {
    console.error(`Error saving/updating JSON to file (${filePath}):`, error); // 这里的日志仍然使用filePath
    return { success: false, error: error.message };
  }
}

/**
 * 从指定的文件读取 JSON 数据。
 * @param {string} filePath 要读取的文件的路径。
 * @returns {Promise<object>} 一个 Promise，解析为包含读取到的 JSON 数据的对象，或者在发生错误时拒绝。
 */
async function readJsonFromFile(filePath) {
  let absoluteFilePath;
  try {
    // ❗ 使用 sanitizePath 进行路径检查
    absoluteFilePath = sanitizePath(filePath, false);

    // 3. 读取文件
    const fileContent = await fs.readFile(absoluteFilePath, 'utf8');

    // 4. 解析 JSON
    const jsonData = JSON.parse(fileContent);

    // 5. 返回结果
    return { success: true, result: jsonData }; // 返回成功，并包含读取到的 JSON 数据
  } catch (error) {
    console.error(`Error reading JSON from file (${filePath}):`, error);
    return {
      success: false,
      error: {
        message: error.message,
        code: error.code, // 可以包含具体的错误代码，如 ENOENT (文件不存在)
      },
    }; // 返回失败，并包含错误信息
  }
}

export { saveJsonToFile, readJsonFromFile, addStaticResources };
