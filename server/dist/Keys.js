// server/dist/Keys.js

import * as fss from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import winston from 'winston';

const logger = winston.createLogger({ // 确保已配置好 Winston logger
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'key-service' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

const saltRounds = 10;
const clientsPath = join(__dirname, '../keys/clients.json'); // 客户端密钥文件路径
let clientKeys = {}; // 在内存中缓存

// 从文件加载客户端密钥 (异步)
async function loadClientKeys() {
  try {
    const data = await fss.readFile(clientsPath, 'utf-8');
    clientKeys = JSON.parse(data);
    logger.info('Client keys loaded.');
  } catch (error) {
    logger.warn('No client keys file found or error loading keys.', error);
    // 抛出错误而不是继续使用空对象
    throw new Error('Failed to load client keys');
  }
}

// 保存客户端密钥到文件 (异步)
async function saveClientKeys() {
  try {
    await fss.writeFile(clientsPath, JSON.stringify(clientKeys, null, 2), 'utf-8');
    logger.info('Client keys saved.');
  } catch (error) {
    logger.error('Failed to save client keys:', error);
    throw new Error('Failed to save client keys'); // 抛出错误
  }
}

// 生成并存储客户端密钥
async function generateAndStoreClientKey(clientId) {
  const key = uuidv4();
  const hashedPassword = await bcrypt.hash(key, saltRounds);
  clientKeys[clientId] = { key: hashedPassword, rooms: [] }; // rooms 字段可能不再需要
  await saveClientKeys(); // 异步保存
  return key;
}

// 获取所有客户端密钥
function getAllClientKeys() {
  return clientKeys;
}

// 获取单个客户端密钥
function getClientKey(clientId) {
  return clientKeys[clientId]?.key; // 使用可选链
}

// 验证密钥
async function isValidClientKey(clientId, key) {
  const clientData = clientKeys[clientId];
  return clientData && (await bcrypt.compare(key, clientData.key));
}

// 移除客户端密钥
async function removeClientKey(clientId) {
  if (clientKeys[clientId]) {
    delete clientKeys[clientId];
    await saveClientKeys(); // 异步保存
  } else {
    // 如果密钥不存在，你可能想要记录一个警告或者什么都不做
    logger.warn(`Attempted to remove non-existent client key for clientId: ${clientId}`);
  }
}

export {
  generateAndStoreClientKey,
  getAllClientKeys,
  getClientKey,
  isValidClientKey,
  removeClientKey,
};

// 立即加载密钥 (确保在服务器启动时加载)
loadClientKeys().catch(error => {
  // 如果加载失败，记录错误并退出进程
  logger.error('Failed to initialize client keys:', error);
  process.exit(1); // 强制退出
});