// server/dist/Rooms.js
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const settingsPath = join(__dirname, '../../settings.json'); // 指向 server/settings.json
let serverSettings;

// 在调用任何函数前都必须先load
function loadSettings() {
  try {
    const settingsData = fs.readFileSync(settingsPath, 'utf-8');
    serverSettings = JSON.parse(settingsData);
  } catch (error) {
    console.error('Failed to load server settings:', error);
    // 如果加载失败，你可能需要设置一个默认值，或者抛出错误
    serverSettings = { extensionRooms: {}, clientKeys: {} }; // 示例默认值, 添加clientKeys
    //throw error; // 或者选择抛出错误, 让调用者处理
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(serverSettings, null, 2), 'utf-8');
    console.log('Server settings saved successfully.');
  } catch (error) {
    console.error('Failed to save server settings:', error);
    //throw error; // 可以选择抛出错误
  }
}

// 创建房间 (仅限扩展)
function createRoom(extensionId, roomName) {
  try {
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
  } catch (error) {
    console.error('Error in createRoom:', error);
    return false; // 或者抛出错误 throw error;
  }
}

// 删除房间 (仅限扩展)
function deleteRoom(extensionId, roomName) {
  try {
    loadSettings();
    if (!serverSettings.extensionRooms[extensionId]) {
      return false;
    }

    const index = serverSettings.extensionRooms[extensionId].indexOf(roomName);
    if (index === -1) {
      return false;
    }

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
  } catch (error) {
    console.error('Error in deleteRoom:', error);
    return false; // 或者抛出错误 throw error;
  }
}

// 将客户端添加到房间 (由扩展调用)
function addClientToRoom(extensionId, clientId, roomName) {
  try {
    loadSettings();
    if (
      !serverSettings.extensionRooms[extensionId] ||
      !serverSettings.extensionRooms[extensionId].includes(roomName) ||
      !serverSettings.clientKeys[clientId]
    ) {
      return false;
    }

    const clientData = serverSettings.clientKeys[clientId];
    if (!clientData.rooms.includes(roomName)) {
      clientData.rooms.push(roomName);
      saveSettings();
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error in addClientToRoom:', error);
    return false; // 或者抛出错误 throw error;
  }
}

// 将客户端从房间移除 (客户端自己调用，或由扩展调用)
function removeClientFromRoom(clientId, roomName) {
  try {
    loadSettings();
    if (!serverSettings.clientKeys[clientId]) {
      return false;
    }

    const clientData = serverSettings.clientKeys[clientId];
    const index = clientData.rooms.indexOf(roomName);
    if (index === -1) {
      return false;
    }

    clientData.rooms.splice(index, 1);
    saveSettings();
    return true;
  } catch (error) {
    console.error('Error in removeClientFromRoom:', error);
    return false; // 或者抛出错误 throw error;
  }
}

// 获取指定扩展的房间列表
function getExtensionRooms(extensionId) {
  try {
    loadSettings();
    return serverSettings.extensionRooms[extensionId] || [];
  } catch (error) {
    console.error('Error in getExtensionRooms:', error);
    return []; // 或者抛出错误, 返回空数组作为默认值
    //throw error;
  }
}

// 获取所有房间
function getAllRooms() {
  try {
    loadSettings();
    let allRooms = [];
    for (const extensionId in serverSettings.extensionRooms) {
      allRooms = [...allRooms, ...serverSettings.extensionRooms[extensionId]];
    }
    return [...new Set(allRooms)]; // 使用 Set 去重
  } catch (error) {
    console.error('Error in getAllRooms:', error);
    return []; // 或者抛出错误, 返回空数组
    //throw error;
  }
}

// 新增：设置客户端描述
function setClientDescription(clientId, description) {
  try {
    loadSettings();
    if (serverSettings.clientKeys[clientId]) {
      serverSettings.clientKeys[clientId].description = description;
      saveSettings();
      return; // 明确的返回
    }
    console.warn(`Client ID ${clientId} not found in setClientDescription.`);
  } catch (error) {
    console.error('Error in setClientDescription:', error);
    // 可以选择不返回值, 或者返回 false, 或者抛出错误
  }
}

// 新增：获取客户端描述
function getClientDescription(clientId) {
  try {
    loadSettings();
    return serverSettings.clientKeys[clientId] ? serverSettings.clientKeys[clientId].description : null;
  } catch (error) {
    console.error('Error in getClientDescription:', error);
    return null; // 或者抛出错误, 返回null
    //throw error;
  }
}

export {
  createRoom,
  deleteRoom,
  addClientToRoom,
  removeClientFromRoom,
  getExtensionRooms,
  getAllRooms,
  setClientDescription,
  getClientDescription,
};
