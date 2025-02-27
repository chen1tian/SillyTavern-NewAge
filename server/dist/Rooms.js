// server/dist/Rooms.js
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const settingsPath = join(__dirname, '../../settings.json'); // 指向 server/settings.json  //应该是server_settings.json
let serverSettings;

// 在调用任何函数前都必须先load
function loadSettings() {
  try {
    const settingsData = fs.readFileSync(join(__dirname, '../../settings/server_settings.json'), 'utf-8');
    serverSettings = { ...serverSettings, ...JSON.parse(settingsData) };
    console.log('Server settings loaded from file.');
  } catch (error) {
    console.log('No settings file found or error loading settings. Using default settings.');
    fs.writeFileSync(
      join(__dirname, '../../settings/server_settings.json'),
      JSON.stringify(serverSettings, null, 2),
      'utf-8',
    );
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(
      join(__dirname, '../../settings/server_settings.json'),
      JSON.stringify(serverSettings, null, 2),
      'utf-8',
    );
    console.log('Server settings saved successfully.');
  } catch (error) {
    console.error('Failed to save server settings:', error);
    //throw error; // 可以选择抛出错误
  }
}

// 创建房间
function createRoom(socket, roomName) {
  if (!socket || !socket.handshake || !socket.handshake.auth) {
    console.warn('Invalid socket object in createRoom');
    return false;
  }
  const clientId = socket.handshake.auth.clientId;
  if (!clientId) {
    console.warn('Invalid clientId object in createRoom');
    return false;
  }

  try {
    // 使用 Socket.IO 的 join 方法
    socket.join(roomName);
    console.log(`Client ${clientId}-${socket.handshake.auth.clientType} created and joined room ${roomName}`);
    return true;
  } catch (error) {
    console.error('Error in createRoom:', error);
    return false;
  }
}

// 删除房间
function deleteRoom(socket, roomName) {
  if (!socket || !socket.handshake || !socket.handshake.auth) {
    console.warn('Invalid socket object in deleteRoom');
    return false;
  }
  const clientId = socket.handshake.auth.clientId;
  if (!clientId) {
    console.warn('Invalid clientId object in deleteRoom');
    return false;
  }

  // 阻止删除与 clientId 同名的房间
  if (clientId === roomName) {
    console.warn(`Client ${clientId} cannot delete room ${roomName} (same as client ID)`);
    return false;
  }

  try {
    // 获取房间内的所有客户端
    const clientsInRoom = io.sockets.adapter.rooms.get(roomName); // 假设你已经有了 io 对象

    if (clientsInRoom) {
      // 强制所有客户端离开房间
      for (const clientSocketId of clientsInRoom) {
        const clientSocket = io.sockets.sockets.get(clientSocketId); // 使用 io.sockets.sockets 获取 socket
        if (clientSocket) {
          clientSocket.leave(roomName);
        }
      }
    }

    console.log(`Room ${roomName} deleted by client ${clientId}`);
    return true;
  } catch (error) {
    console.error('Error in deleteRoom:', error);
    return false;
  }
}

// 将客户端添加到房间
function addClientToRoom(socket, roomName) {
  if (!socket || !socket.handshake || !socket.handshake.auth) {
    console.warn('Invalid socket object in addClientToRoom');
    return false;
  }
  const clientId = socket.handshake.auth.clientId;
  if (!clientId) {
    console.warn('Invalid clientId object in addClientToRoom');
    return false;
  }
  try {
    socket.join(roomName);
    console.log(`Client ${clientId} added to room ${roomName}`);
    return true;
  } catch (error) {
    console.error('Error in addClientToRoom:', error);
    return false;
  }
}

// 将客户端从房间移除
function removeClientFromRoom(socket, roomName) {
  if (!socket || !socket.handshake || !socket.handshake.auth) {
    console.warn('Invalid socket object in removeClientFromRoom');
    return false;
  }
  const clientId = socket.handshake.auth.clientId;

  if (!clientId) {
    console.warn('Invalid clientId object in removeClientFromRoom');
    return false;
  }
  // 阻止客户端将自己从与其 ID 同名的房间中移除
  if (clientId === roomName) {
    console.warn(`Client ${clientId} cannot remove themselves from room ${roomName} (same as client ID)`);
    return false;
  }

  try {
    socket.leave(roomName);
    console.log(`Client ${clientId} removed from room ${roomName}`);
    return true;
  } catch (error) {
    console.error('Error in removeClientFromRoom:', error);
    return false;
  }
}

//检查客户端是否在房间内
function isClientInRoom(clientId, roomName) {
  try {
    const clients = io.sockets.adapter.rooms.get(roomName); // 获取房间内的所有客户端
    if (!clients) {
      return false; // 房间不存在
    }

    for (const clientSocketId of clients) {
      const clientSocket = io.sockets.sockets.get(clientSocketId);
      if (clientSocket && clientSocket.handshake.auth.clientId === clientId) {
        return true; // 找到匹配的 clientId
      }
    }
    return false;
  } catch (error) {
    console.error('Error in isClientInRoom:', error);
    return false;
  }
}

// 获取所有房间
function getAllRooms() {
  try {
    const rooms = io.sockets.adapter.rooms; // 获取所有房间
    return [...rooms.keys()]; // 返回房间名的数组
  } catch (error) {
    console.error('Error in getAllRooms:', error);
    return [];
  }
}

// 获取指定客户端所在的房间列表 (可选, 根据需要实现)
function getClientRooms(socket) {
  if (!socket || !socket.rooms) {
    console.warn('Invalid socket object in getClientRooms');
    return [];
  }
  try {
    return Array.from(socket.rooms);
  } catch (error) {
    console.error('Error in getClientRooms:', error);
    return [];
  }
}

// 新增：设置客户端描述 (可选, 根据需要决定是否保留)
function setClientDescription(clientId, description) {
  console.warn('This Function is Deprecated, and do nothing.');
}

// 新增：获取客户端描述 (可选, 根据需要决定是否保留)
function getClientDescription(clientId) {
  console.warn('This Function is Deprecated, and do nothing.');
}

export {
  createRoom,
  deleteRoom,
  addClientToRoom,
  removeClientFromRoom,
  isClientInRoom,
  getAllRooms,
  getClientRooms, // 可选
  setClientDescription, // 可选
  getClientDescription, // 可选
};

