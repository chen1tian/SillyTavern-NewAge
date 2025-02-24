// lib/Rooms.js

import { MSG_TYPE } from '../lib/constants.js'; // 假设 constants.js 在同一目录下

/**
 * 创建房间
 * @param {import('socket.io-client').Socket} socket - Socket.IO 客户端实例
 * @param {string} roomName - 要创建的房间名称
 * @returns {Promise<boolean>} - 创建成功返回 true，失败返回 false
 */
function createRoom(socket, roomName) {
  return new Promise(resolve => {
    socket.emit(MSG_TYPE.CREATE_ROOM, roomName, response => {
      if (response.status === 'ok') {
        console.log(`Room created: ${roomName}`);
        resolve(true);
      } else {
        console.error(`Failed to create room: ${response.message}`);
        resolve(false);
      }
    });
  });
}

/**
 * 删除房间
 * @param {import('socket.io-client').Socket} socket - Socket.IO 客户端实例
 * @param {string} roomName - 要删除的房间名称
 * @returns {Promise<boolean>} - 删除成功返回 true，失败返回 false
 */
function deleteRoom(socket, roomName) {
  return new Promise(resolve => {
    socket.emit(MSG_TYPE.DELETE_ROOM, roomName, response => {
      if (response.status === 'ok') {
        console.log(`Room deleted: ${roomName}`);
        resolve(true);
      } else {
        console.error(`Failed to delete room: ${response.message}`);
        resolve(false);
      }
    });
  });
}

/**
 * 将客户端添加到房间
 * @param {import('socket.io-client').Socket} socket - Socket.IO 客户端实例
 * @param {string} clientId - 要添加的客户端 ID
 * @param {string} roomName - 要加入的房间名称
 * @returns {Promise<boolean>} - 添加成功返回 true，失败返回 false
 */
function addClientToRoom(socket, clientId, roomName) {
  return new Promise(resolve => {
    socket.emit(MSG_TYPE.ADD_CLIENT_TO_ROOM, { clientId, roomName }, response => {
      if (response.status === 'ok') {
        console.log(`Client ${clientId} added to room: ${roomName}`);
        resolve(true);
      } else {
        console.error(`Failed to add client to room: ${response.message}`);
        resolve(false);
      }
    });
  });
}

/**
 * 将客户端从房间移除
 * @param {import('socket.io-client').Socket} socket - Socket.IO 客户端实例
 * @param {string} clientId - 要移除的客户端 ID (可选, 默认是自己)
 * @param {string} roomName - 要离开的房间名称
 * @returns {Promise<boolean>} - 移除成功返回 true，失败返回 false
 */
function removeClientFromRoom(socket, clientId, roomName) {
  return new Promise(resolve => {
    const data = clientId ? { clientId, roomName } : { roomName };
    socket.emit(MSG_TYPE.REMOVE_CLIENT_FROM_ROOM, data, response => {
      if (response.status === 'ok') {
        console.log(
          clientId ? `Client ${clientId} removed from room: ${roomName}` : `Client removed from room: ${roomName}`,
        );
        resolve(true);
      } else {
        console.error(`Failed to remove client from room: ${response.message}`);
        resolve(false);
      }
    });
  });
}

/**
 * 获取当前服务器的房间列表
 * @param { import('socket.io-client').Socket } socket - Socket.IO 客户端实例
 * @returns {Promise<string[]>}  - 返回房间列表
 */
function getRooms(socket) {
  return new Promise(resolve => {
    socket.emit('getRooms', null, rooms => {
      console.log(`get rooms: ${rooms}`);
      resolve(rooms);
    });
  });
}

export { createRoom, deleteRoom, addClientToRoom, removeClientFromRoom, getRooms };
