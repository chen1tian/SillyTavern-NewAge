// server/dist/Rooms.js
import fs from 'fs';
import { join } from 'path';

const settingsPath = join(__dirname, '../../settings.json'); // 指向 server/settings.json
let serverSettings;

//在调用任何函数前都必须先load
function loadSettings() {
  try {
    const settingsData = fs.readFileSync(settingsPath, 'utf-8');
    serverSettings = JSON.parse(settingsData);
  } catch (error) {
    console.error('Failed to load server settings:', error);
    // 如果加载失败，你可能需要设置一个默认值，或者抛出错误
    serverSettings = { extensionRooms: {} }; // 示例默认值
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(serverSettings, null, 2), 'utf-8');
    console.log('Server settings saved successfully.');
  } catch (error) {
    console.error('Failed to save server settings:', error);
  }
}

// 创建房间 (仅限扩展)
function createRoom(extensionId, roomName) {
  loadSettings();
  if (!serverSettings.extensionRooms[extensionId]) {
    serverSettings.extensionRooms[extensionId] = [];
  }
  if (!serverSettings.extensionRooms[extensionId].includes(roomName)) {
    serverSettings.extensionRooms[extensionId].push(roomName);
    saveSettings();
    return true;
  }
  return false;
}

// 删除房间 (仅限扩展)
function deleteRoom(extensionId, roomName) {
  loadSettings();
  if (serverSettings.extensionRooms[extensionId]) {
    const index = serverSettings.extensionRooms[extensionId].indexOf(roomName);
    if (index > -1) {
      serverSettings.extensionRooms[extensionId].splice(index, 1);

      // 从所有客户端的房间列表中移除该房间
      if (serverSettings.clientKeys) {
        for (const clientId in serverSettings.clientKeys) {
          const clientData = serverSettings.clientKeys[clientId];
          const roomIndex = clientData.rooms.indexOf(roomName);
          if (roomIndex > -1) {
            clientData.rooms.splice(roomIndex, 1);
          }
        }
      }
      saveSettings();
      return true;
    }
  }
  return false;
}

// 将客户端添加到房间 (由扩展调用)
function addClientToRoom(extensionId, clientId, roomName) {
  loadSettings();
  if (
    serverSettings.extensionRooms[extensionId] &&
    serverSettings.extensionRooms[extensionId].includes(roomName) &&
    serverSettings.clientKeys[clientId]
  ) {
    const clientData = serverSettings.clientKeys[clientId];
    if (!clientData.rooms.includes(roomName)) {
      clientData.rooms.push(roomName);
      saveSettings();
      return true;
    }
  }
  return false;
}

// 将客户端从房间移除 (客户端自己调用，或由扩展调用)
function removeClientFromRoom(clientId, roomName) {
  loadSettings();
  if (serverSettings.clientKeys[clientId]) {
    const clientData = serverSettings.clientKeys[clientId];
    const index = clientData.rooms.indexOf(roomName);
    if (index > -1) {
      clientData.rooms.splice(index, 1);
      saveSettings();
      return true;
    }
  }
  return false;
}

// 获取指定扩展的房间列表
function getExtensionRooms(extensionId) {
  loadSettings();
  return serverSettings.extensionRooms[extensionId] || [];
}
// 获取所有房间
function getAllRooms() {
  loadSettings();
  let allRooms = [];
  for (const extensionId in serverSettings.extensionRooms) {
    allRooms = [...allRooms, ...serverSettings.extensionRooms[extensionId]];
  }
  return [...new Set(allRooms)]; // 使用 Set 去重
}

// 新增：设置客户端描述
function setClientDescription(clientId, description) {
    loadSettings();
    if (serverSettings.clientKeys[clientId]) {
        serverSettings.clientKeys[clientId].description = description;
        saveSettings();
    }
}

// 新增：获取客户端描述
function getClientDescription(clientId) {
    loadSettings();
    return serverSettings.clientKeys[clientId] ? serverSettings.clientKeys[clientId].description : null;
}

export {
    createRoom,
    deleteRoom,
    addClientToRoom,
    removeClientFromRoom,
    getExtensionRooms,
    getAllRooms,
    setClientDescription, // 新增
    getClientDescription, // 新增
};
