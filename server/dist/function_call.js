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
    // 路径处理逻辑
    let absoluteFilePath = filePath;
    if (!isAbsolute(filePath)) {
      const projectRoot = join(__dirname, '..');
      absoluteFilePath = join(projectRoot, filePath);
    }

    absoluteFilePath = normalize(absoluteFilePath);
    console.log("absoluteFilePath:", absoluteFilePath);

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
      if (readError.code !== 'ENOENT') { // ENOENT 表示文件不存在
        console.error(`Error reading existing JSON file (${absoluteFilePath}):`, readError);
        //  这里可以选择 re-throw 或返回错误，具体取决于你的需求。
        //  如果希望在读取错误时也停止操作，则取消下面这行的注释
        // throw readError; //  或 return { success: false, error: readError.message };
        // 否则, 就仅仅是打印一下错误, 然后认为文件不存在(内容为空)
      }
    }

    // 合并现有数据和新数据 (新数据覆盖旧数据)
    const updatedData = { ...existingData, ...jsonData };

    // 写入更新后的数据
    await fs.writeFile(absoluteFilePath, JSON.stringify(updatedData, null, 2), 'utf8');
    console.log(`JSON data updated in: ${absoluteFilePath}`);
    return { success: true };

  } catch (error) {
    console.error(`Error saving/updating JSON to file (${absoluteFilePath}):`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 从指定的文件读取 JSON 数据。
 * @param {string} filePath 要读取的文件的路径。
 * @returns {Promise<object>} 一个 Promise，解析为包含读取到的 JSON 数据的对象，或者在发生错误时拒绝。
 */
async function readJsonFromFile(filePath) {
    try {
        // 1. 路径处理
        let absoluteFilePath = filePath;
        if (!isAbsolute(filePath)) {
            // 如果 filePath 是相对路径，则转换为绝对路径
            const projectRoot = join(__dirname, '..'); // 项目根目录
            absoluteFilePath = join(projectRoot, filePath);
        }

        absoluteFilePath = normalize(absoluteFilePath);
        console.log("absoluteFilePath:", absoluteFilePath);

        // 2. (可选) 安全检查：防止路径遍历攻击 (根据你的需要决定是否保留)
        // if (absoluteFilePath.indexOf('..') !== -1 || absoluteFilePath.indexOf(':') !== -1 || absoluteFilePath.indexOf('\0') !== -1) {
        //     throw new Error('Invalid file path');
        // }

        // 3. 读取文件
        const fileContent = await fs.readFile(absoluteFilePath, 'utf8');

        // 4. 解析 JSON
        const jsonData = JSON.parse(fileContent);

        // 5. 返回结果
        return { success: true, result: jsonData }; // 返回成功，并包含读取到的 JSON 数据
    } catch (error) {
        console.error(`Error reading JSON from file (${absoluteFilePath}):`, error);
        return {
            success: false,
            error: {
                message: error.message,
                code: error.code, // 可以包含具体的错误代码，如 ENOENT (文件不存在)
            },
        }; // 返回失败，并包含错误信息
    }
}

export { saveJsonToFile , readJsonFromFile };