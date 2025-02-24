// server/dist/Keys.js

import fs from 'fs';
import { join } from 'path';
import { uuidv4 } from '../../lib/uuid/uuid.js';
import bcrypt from 'bcrypt';

const saltRounds = 10;
const clientsPath = join(__dirname, '../../clients.json'); // 客户端密钥文件路径
let clientKeys = {}; // 在内存中缓存

// 从文件加载客户端密钥
function loadClientKeys() {
  try {
    const data = fs.readFileSync(clientsPath, 'utf-8');
    clientKeys = JSON.parse(data);
    console.log('Client keys loaded.');
  } catch (error) {
    console.log('No client keys file found or error loading keys. Using empty object.');
    clientKeys = {}; // 初始化为空对象
  }
}

// 保存客户端密钥到文件
function saveClientKeys() {
  try {
    fs.writeFileSync(clientsPath, JSON.stringify(clientKeys, null, 2), 'utf-8');
    console.log('Client keys saved.');
  } catch (error) {
    console.error('Failed to save client keys:', error);
  }
}
// 载入
loadClientKeys();

// 生成并存储客户端密钥
async function generateAndStoreClientKey(clientId) {
  const key = uuidv4();
  const hashedPassword = await bcrypt.hash(key, saltRounds);
  clientKeys[clientId] = { key: hashedPassword, rooms: [] };
  saveClientKeys(); // 保存到文件
  return key;
}

// 移除客户端密钥
function removeClientKey(clientId) {
  delete clientKeys[clientId];
  saveClientKeys(); // 保存到文件
}

// 验证密钥
async function isValidClientKey(clientId, key) {
  const clientData = clientKeys[clientId];
  return clientData && (await bcrypt.compare(key, clientData.key));
}

// 获取客户端的房间
function getClientRooms(clientId) {
  return clientKeys[clientId] ? clientKeys[clientId].rooms : [];
}
// 设置客户端房间
function setClientRooms(clientId, rooms) {
  if (clientKeys[clientId]) {
    clientKeys[clientId].rooms = rooms;
    saveClientKeys();
  }
}

//新增：获取所有客户端信息
function getAllClientKeys() {
    return clientKeys;
}

function getClientKey(clientId) {
  loadClientKeys();
  return clientKeys[clientId] ? clientKeys[clientId].key : null;
}

export {
  generateAndStoreClientKey,
  removeClientKey,
  isValidClientKey,
  getClientRooms,
  setClientRooms,
  getAllClientKeys,
  getClientKey,
};
