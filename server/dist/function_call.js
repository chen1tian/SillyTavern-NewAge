// server/dist/function_call.js

import * as fss from 'fs/promises';
import express from 'express';
import { dirname, join, isAbsolute, normalize, relative, sep } from 'path';
import { fileURLToPath } from 'url';

import { serverSettings } from '../server.js'; // 导入 serverSettings

import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const serverRoot = join(__dirname, '..'); // 定义 server 文件夹的绝对路径

/**
 * 路径安全检查函数
 * @param {string} filePath - 用户提供的文件路径
 * @param {boolean} isRestrictedFiles - 是否检查受限文件列表
 * @returns {string} - 规范化后的绝对路径
 * @throws {Error} - 如果路径无效或越界，则抛出错误
 */
function sanitizePath(filePath, isRestricted = true) {
  let absoluteFilePath = filePath;

  // 1. 转换为绝对路径
  if (!isAbsolute(filePath)) {
    absoluteFilePath = join(serverRoot, filePath);
  }

  // 2. 规范化路径
  absoluteFilePath = normalize(absoluteFilePath);

  // 3. 越界检查 (检查是否超出 serverRoot)
  const serverRootParts = serverRoot.split(sep);
  const filePathParts = absoluteFilePath.split(sep);

  for (let i = 0; i < serverRootParts.length; i++) {
    if (filePathParts[i] !== serverRootParts[i]) {
      throw new Error('Access denied: Path is outside the server directory.');
    }
  }

  // 4. 检查是否在受限文件列表中 (如果在 isRestricted 为 true 时)
  if (isRestricted) {
    const relativePath = relative(serverRoot, absoluteFilePath);
    if (serverSettings.restrictedFiles.includes(relativePath)) {
      throw new Error('Access denied: File is restricted.');
    }
  }

  return absoluteFilePath;
}

/**
 * 动态添加静态资源的函数
 * @param {Express.Application} app - Express 应用实例
 * @param {object} resources - 要添加的静态资源，格式为 { urlPath: relativeFilePath, ... }
 * @returns {Promise<{ success: boolean; results: object[] }>} - 返回操作结果
 */
async function addStaticResources(app, resources) {
  const results = [];

  for (const urlPath in resources) {
    if (resources.hasOwnProperty(urlPath)) {
      const relativeFilePath = resources[urlPath];
      try {
        const absoluteFilePath = sanitizePath(relativeFilePath, false); // 不检查 restrictedFiles
        app.use(urlPath, express.static(absoluteFilePath));
        logger.info(`Added static resource route: ${urlPath} -> ${absoluteFilePath}`);
        results.push({ urlPath, status: 'success' });
      } catch (error) {
        logger.error(`Error adding static resource ${urlPath}:`, error);
        results.push({ urlPath, status: 'error', message: error.message });
      }
    }
  }

  return { success: results.every(result => result.status === 'success'), results };
}

/**
 * 将 JSON 数据保存到文件 (合并现有数据)
 * @param {string} filePath - 文件路径
 * @param {object} jsonData - 要保存的 JSON 数据
 * @returns {Promise<{ success: boolean, error?: string }>} - 返回操作结果
 */
async function saveJsonToFile(filePath, jsonData) {
  try {
    const absoluteFilePath = sanitizePath(filePath);
    const dir = dirname(absoluteFilePath);

    // 确保目录存在
    await fss.mkdir(dir, { recursive: true });

    let existingData = {};
    try {
      const fileContent = await fss.readFile(absoluteFilePath, 'utf8');
      existingData = JSON.parse(fileContent);
    } catch (readError) {
      if (readError.code !== 'ENOENT') {
        logger.error(`Error reading existing JSON file (${absoluteFilePath}):`, readError);
      }
    }

    // 合并现有数据和新数据 (新数据覆盖旧数据)
    const updatedData = { ...existingData, ...jsonData };

    await fss.writeFile(absoluteFilePath, JSON.stringify(updatedData, null, 2), 'utf8');
    logger.info(`JSON data updated in: ${absoluteFilePath}`);
    return { success: true };
  } catch (error) {
    logger.error(`Error saving/updating JSON to file (${filePath}):`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 从指定的文件读取 JSON 数据
 * @param {string} filePath - 文件路径
 * @returns {Promise<{ success: boolean, result?: object, error?: { message: string, code?: string } }>} - 返回操作结果
 */
async function readJsonFromFile(filePath) {
  try {
    const absoluteFilePath = sanitizePath(filePath, false); // 不检查 restrictedFiles
    const fileContent = await fss.readFile(absoluteFilePath, 'utf8');
    const jsonData = JSON.parse(fileContent);
    return { success: true, result: jsonData };
  } catch (error) {
    logger.error(`Error reading JSON from file (${filePath}):`, error);
    return {
      success: false,
      error: {
        message: error.message,
        code: error.code,
      },
    };
  }
}

export { addStaticResources, readJsonFromFile, saveJsonToFile };