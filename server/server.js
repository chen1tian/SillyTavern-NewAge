import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { setupServerNonStreamHandlers } from '../lib/non_stream.js';
import { setupServerStreamHandlers, forwardStreamData } from '../lib/stream.js';
import { NAMESPACES, MSG_TYPE } from '../lib/constants.js';
import { uuidv4 } from '../lib/uuid/uuid.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import * as functionCall from './dist/function_call.js';

// 导入模块
import * as Rooms from './dist/Rooms.js';
import * as Keys from './dist/Keys.js';
//import * as Passwords from './dist/Passwords.js'; // 如果使用了单独的密码文件

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const saltRounds = 10;

let io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  serveClient: true,
});

let serverSettings = {
  serverPort: 4000,
  serverAddress: 'http://localhost',
  reconnectAttempts: 3,
  reconnectDelay: 1000,
  timeout: 5000,
  autoConnect: true,
  socketIOPath: '/socket.io',
  queryParameters: {},
  transport: 'websocket',
};

/**
 * @description 从文件加载服务器设置 / Loads server settings from a file.
 * @function loadServerSettings
 * @returns {void}
 */
function loadServerSettings() {
  try {
    const settingsData = fs.readFileSync(join(__dirname, './settings.json'), 'utf-8');
    serverSettings = { ...serverSettings, ...JSON.parse(settingsData) };
    console.log('Server settings loaded from file.');
  } catch (error) {
    console.log('No settings file found or error loading settings. Using default settings.');
    fs.writeFileSync(join(__dirname, './settings.json'), JSON.stringify(serverSettings, null, 2), 'utf-8');
  }
}

/**
 * @description 将服务器设置保存到文件 / Saves server settings to a file.
 * @function saveServerSettings
 * @param {object} newSettings - 要保存的新设置 / New settings to save.
 * @returns {void}
 */
function saveServerSettings(newSettings) {
  try {
    fs.writeFileSync(join(__dirname, './settings.json'), JSON.stringify(newSettings, null, 2), 'utf-8');
    console.log('Server settings saved successfully.');
  } catch (error) {
    console.error('Failed to save server settings:', error);
  }
}

loadServerSettings();

/**
 * @description 重新初始化 Socket.IO 服务器 / Reinitializes the Socket.IO server.
 * @function reinitializeSocketIO
 * @param {object} newSettings - 新的服务器设置 / New server settings.
 * @returns {void}
 */
function reinitializeSocketIO(newSettings) {
  serverSettings = { ...serverSettings, ...newSettings };
  io.of(NAMESPACES.GENERAL).removeAllListeners();
  setupServerNonStreamHandlers(io, NAMESPACES.GENERAL);
  const forwardHandler = forwardStreamData(io, NAMESPACES.GENERAL, 'monitor-room'); //必须要有monitor-room
  setupServerStreamHandlers(io, NAMESPACES.GENERAL, forwardHandler);
}

let requestQueue = [];
let sillyTavernSocketId = null;
let isSillyTavernConnected = false;

/**
 * @description 处理 LLM 请求 / Processes the LLM request.
 * @function processLLMRequest
 * @returns {void}
 */
function processLLMRequest() {
  if (sillyTavernSocketId && isSillyTavernConnected && requestQueue.length > 0) {
    const request = requestQueue.shift();
    io.to(sillyTavernSocketId).emit(MSG_TYPE.LLM_REQUEST, request);
    console.log(`Forwarding LLM request to SillyTavern: ${request.requestId}`);
  }
}

const functionRegistry = {};

/**
 * @description 注册一个函数以供 function_call 调用 / Registers a function for function_call.
 * @function registerFunction
 * @param {string} name - 函数名称 / The name of the function.
 * @param {Function} func - 要注册的函数 / The function to register.
 * @returns {void}
 */
function registerFunction(name, func) {
  if (functionRegistry[name]) {
    console.warn(`Function "${name}" is already registered. Overwriting.`);
  }
  functionRegistry[name] = func;
  console.log(`Function "${name}" registered for function_call.`);
}

// 在服务器启动时注册函数
import * as functionCall from './dist/function_call.js'; // 导入所有函数
for (const functionName in functionCall) {
  if (typeof functionCall[functionName] === 'function') {
    registerFunction(functionName, functionCall[functionName]);
  }
}

/**
 * @description 处理 function_call 请求 / Handles a function_call request.
 * @function handleFunctionCallRequest
 * @async
 * @param {import('socket.io').Socket} socket - Socket.IO Socket 实例 / Socket.IO Socket instance.
 * @param {object} data - 请求数据 / Request data.
 * @param {string} data.requestId - 请求 ID / Request ID.
 * @param {string} data.functionName - 要调用的函数名称 / Name of the function to call.
 * @param {any[]} data.args - 函数参数 / Function arguments.
 * @param {Function} callback - 回调函数 / Callback function.
 * @returns {Promise<void>}
 */
async function handleFunctionCallRequest(socket, data, callback) {
  const { requestId, functionName, args, target } = data; // 添加 target

  if (target === 'server') {
    // 服务器端函数调用
    const func = functionRegistry[functionName];
    if (!func) {
      console.warn(`Function "${functionName}" not found.`);
      callback({
        requestId,
        success: false,
        error: { message: `Function "${functionName}" not found.` },
      });
      return;
    }

    try {
      const result = await func(...args);
      callback({ requestId, success: true, result });
    } catch (error) {
      console.error(`Error calling function "${functionName}":`, error);
      callback({
        requestId,
        success: false,
        error: { message: error.message || 'An unknown error occurred.' },
      });
    }
  } else {
    // 转发给 SillyTavern 扩展
    io.to(target).emit(MSG_TYPE.FUNCTION_CALL, data, callback);
  }
}

/**
 * @description 验证客户端密钥 / Validates a client's key.
 * @function isValidKey
 * @async
 * @param {string} clientId - 客户端 ID / The client ID.
 * @param {string} key - 客户端提供的密钥 / The key provided by the client.
 * @returns {Promise<boolean>} - 如果密钥有效，则返回 true；否则返回 false / True if the key is valid, false otherwise.
 */
async function isValidKey(clientId, key) {
  if (clientId === sillyTavernSocketId) {
    return await bcrypt.compare(key, serverSettings.sillyTavernMasterKey);
  } else {
    return await Keys.isValidClientKey(clientId, key);
  }
}

/**
 * @description 检查发送者是否有权限向目标房间发送消息 / Checks if a sender is allowed to send a message to a target room.
 * @function canSendMessage
 * @param {string} senderClientId - 发送者客户端 ID / The sender's client ID.
 * @param {string} targetRoom - 目标房间名称 / The target room name.
 * @returns {boolean} - 如果允许发送，则返回 true；否则返回 false / True if sending is allowed, false otherwise.
 */
function canSendMessage(senderClientId, targetRoom) {
  if (targetRoom === 'server') {
    return true;
  }

  if (senderClientId === sillyTavernSocketId) {
    return true;
  }

  const senderData = Keys.clientKeys[senderClientId]; // 通过Keys获取
  if (senderData && senderData.rooms.includes(targetRoom)) {
    return true;
  }

  return false;
}

io.on('connection', async socket => {
  const clientType = socket.handshake.auth.clientType;
  const clientId = socket.handshake.auth.clientId; // 从 auth 中获取 clientId
  const clientKey = socket.handshake.auth.key;
  const clientDesc = socket.handshake.auth.desc; // 客户端描述

  if (!clientId) {
    console.warn('Client connected without clientId. Disconnecting.');
    socket.disconnect(true);
    return;
  }

  if (!(await isValidKey(clientId, clientKey))) {
    console.warn(`Client ${clientId} provided invalid key. Disconnecting.`);
    socket.disconnect(true);
    return;
  }

  Rooms.createRoom(clientId, clientId);
  Rooms.addClientToRoom(clientId, clientId, clientId);
  Rooms.setClientDescription(clientId, clientDesc);

  socket.join(clientId);
  console.log(`Client ${clientId} connected and joined room ${clientId}`);

  // SillyTavern 扩展认证
  socket.on(MSG_TYPE.IDENTIFY_SILLYTAVERN, async data => {
    // data: { key: string }
    if (serverSettings.sillyTavernMasterKey) {
      console.warn('SillyTavern master key already set. Ignoring new key.');
      return;
    }
    sillyTavernSocketId = socket.id;
    isSillyTavernConnected = true;

    const hashedPassword = await bcrypt.hash(data.key, saltRounds);
    serverSettings.sillyTavernMasterKey = hashedPassword;

    console.log(`SillyTavern identified with socket ID: ${sillyTavernSocketId}`);
    saveServerSettings(serverSettings);
    processLLMRequest();
  });

  // 添加 MSG_TYPE.GET_CLIENT_KEY 的处理
  socket.on(MSG_TYPE.GET_CLIENT_KEY, async (data, callback) => {
    if (clientId !== sillyTavernSocketId) {
      callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    const targetClientId = data.clientId;
    const key = Keys.getClientKey(targetClientId); 
    if (key) {
      callback({ status: 'ok', key: key });
    } else {
      callback({ status: 'error', message: 'Client key not found.' });
    }
  });

  // 设置 /function_call 命名空间
  const functionCallNsp = io.of(NAMESPACES.FUNCTION_CALL);
  functionCallNsp.on('connection', socket => {
    console.log(`Client connected to ${NAMESPACES.FUNCTION_CALL} namespace`);

    // 监听 function_call 事件
    socket.on(MSG_TYPE.FUNCTION_CALL, (data, callback) => {
      // data: { requestId: string, functionName: string, args: any[] }
      console.log(`Received function_call request:`, data);
      handleFunctionCallRequest(socket, data, callback);
    });

    socket.on('disconnect', reason => {
      console.log(`Client disconnected from ${NAMESPACES.FUNCTION_CALL} namespace: ${reason}`);
    });
  });

  if (clientType === 'monitor') {
    console.log('Monitor client connected');
    socket.join('monitor-room');
  } else if (clientType === 'extension') {
    console.log(`Extension client connected: ${clientId}`);
    socket.join(clientId); // 为扩展分配唯一房间
  }

  // 监听客户端设置
  socket.on(MSG_TYPE.CLIENT_SETTINGS, clientSettings => {
    // 验证发送者是否是 SillyTavern 扩展
    if (clientId !== sillyTavernSocketId) {
      console.warn(`Client ${clientId} is not authorized to send CLIENT_SETTINGS.`);
      // 可以选择向发送者发送错误消息
      socket.emit(MSG_TYPE.ERROR, {
        type: MSG_TYPE.ERROR,
        message: 'Unauthorized: Only SillyTavern extension can send client settings.',
        requestId: clientSettings.requestId, // 如果有 requestId
      });
      return; // 阻止后续代码执行
    }

    console.log('Received client settings:', clientSettings);
    reinitializeSocketIO(clientSettings);
    saveServerSettings(serverSettings);
  });

  // 监听 LLM 请求
  socket.on(MSG_TYPE.LLM_REQUEST, data => {
    // data: { clientId: string, requestId: string, message: string, target: string }
    console.log(`Received LLM request from ${clientId}:`, data);

    const target = data.target;
    if (!canSendMessage(clientId, target)) {
      console.warn(`Client ${clientId} is not allowed to send messages to room ${target}.`);
      return;
    }

    if (target === 'server') {
      requestQueue.push({
        clientId: clientId,
        requestId: data.requestId,
        message: data.message,
      });
      processLLMRequest();
    } else {
      io.to(target).emit(MSG_TYPE.LLM_REQUEST, data);
    }
  });

  // 监听 LLM 响应
  socket.on(MSG_TYPE.LLM_RESPONSE, data => {
    // data: { requestId: string, message: string, target: string }
    console.log(`Received LLM response from ${clientId}:`, data);

    const target = data.target;
    if (!canSendMessage(clientId, target)) {
      console.warn(`Client ${clientId} is not allowed to send messages to room ${target}.`);
      return;
    }

    if (target === 'server') {
      const originalRequest = requestQueue.find(req => req.requestId === data.requestId);
      if (originalRequest) {
        io.to(originalRequest.clientId).emit(MSG_TYPE.LLM_RESPONSE, {
          requestId: data.requestId,
          message: data.message,
        });
        processLLMRequest();
      } else {
        console.warn(`Original request not found for requestId: ${data.requestId}`);
      }
    } else {
      io.to(target).emit(MSG_TYPE.LLM_RESPONSE, data);
    }
  });

  // 房间管理 (仅限 SillyTavern 扩展)
  socket.on(MSG_TYPE.CREATE_ROOM, (data, callback) => {
    // data: {roomName: string}
    if (clientId !== sillyTavernSocketId) {
      callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    if (Rooms.createRoom(clientId, data.roomName)) {
      callback({ status: 'ok' });
    } else {
      callback({ status: 'error', message: 'Room already exists' });
    }
  });

  socket.on(MSG_TYPE.DELETE_ROOM, (data, callback) => {
    // data: {roomName: string}
    if (clientId !== sillyTavernSocketId) {
      callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    if (Rooms.deleteRoom(clientId, data.roomName)) {
      callback({ status: 'ok' });
    } else {
      callback({ status: 'error', message: 'Room does not exist' });
    }
  });

  socket.on(MSG_TYPE.ADD_CLIENT_TO_ROOM, (data, callback) => {
    // data: { clientId: string, roomName: string }
    if (clientId !== sillyTavernSocketId) {
      callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    const { clientId: targetClientId, roomName } = data;
    if (Rooms.addClientToRoom(clientId, targetClientId, roomName)) {
      io.to(targetClientId).socketsJoin(roomName);
      callback({ status: 'ok' });
    } else {
      callback({
        status: 'error',
        message: 'Failed to add client to room',
      });
    }
  });

  socket.on(MSG_TYPE.REMOVE_CLIENT_FROM_ROOM, (data, callback) => {
    // data: { clientId: string, roomName: string }
    const { clientId: targetClientId, roomName } = data;
    if (clientId !== sillyTavernSocketId && clientId !== targetClientId) {
      callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    if (Rooms.removeClientFromRoom(targetClientId, roomName)) {
      io.to(targetClientId).socketsLeave(roomName);
      callback({ status: 'ok' });
    } else {
      callback({
        status: 'error',
        message: 'Failed to remove client from room',
      });
    }
  });
  //生成客户端密钥
  socket.on(MSG_TYPE.GENERATE_CLIENT_KEY, async (data, callback) => {
    // data: { clientId: string }
    if (clientId !== sillyTavernSocketId) {
      callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    const targetClientId = data.clientId;
    const key = await Keys.generateAndStoreClientKey(targetClientId);
    callback({ status: 'ok', key: key });
  });

  //移除客户端密钥
  socket.on(MSG_TYPE.REMOVE_CLIENT_KEY, (data, callback) => {
    // data: { clientId: string }
    if (clientId !== sillyTavernSocketId) {
      callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    const targetClientId = data.clientId;
    Keys.removeClientKey(targetClientId);
    callback({ status: 'ok' });
  });

  //获取客户端列表
  socket.on(MSG_TYPE.GET_ROOMS, (data, callback) => {
    // data: {}
    if (clientId !== sillyTavernSocketId) {
      callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    const rooms = Rooms.getAllRooms();
    callback(rooms);
  });

  // 新增：获取客户端列表
  socket.on('getClientsInRoom', (roomName, callback) => {
    const clients = io.sockets.adapter.rooms.get(roomName);
    const clientIds = clients ? Array.from(clients).filter(id => id !== undefined) : [];

    // 获取客户端的描述信息
    const clientInfo = clientIds.map(id => {
      const desc = Rooms.getClientDescription(id); // 从 Rooms.js 获取描述
      return { id, description: desc };
    });

    callback(clientInfo);
  });

  // 新增：获取房间内的客户端
  socket.on('getClientList', (data, callback) => {
    if (clientId !== sillyTavernSocketId) {
      callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    const clients = [];
    for (const id in Keys.getAllClientKeys()) {
      // 使用 Keys.getAllClientKeys()
      clients.push({
        id,
        description: Rooms.getClientDescription(id), // 获取客户端描述
        // rooms: Keys.getClientRooms(id), // 如果需要，可以包含客户端所属房间
      });
    }
    callback(clients);
  });

  // 新增：服务器验证密码
  socket.on(MSG_TYPE.LOGIN, async (data, callback) => {
    //data: {password: string}
    const { password } = data;

    if (serverSettings.sillyTavernPassword) {
      const isMatch = await bcrypt.compare(password, serverSettings.sillyTavernPassword);
      if (isMatch) {
        callback({ success: true });
      } else {
        callback({ success: false, message: 'Incorrect password.' });
      }
    } else {
      callback({ success: false, message: 'Password not set on server.' });
    }
  });

  socket.on('disconnect', reason => {
    console.log(`Client ${clientId} disconnected: ${reason}`);

    const initialQueueLength = requestQueue.length;
    requestQueue = requestQueue.filter(req => req.clientId !== clientId);
    if (requestQueue.length < initialQueueLength) {
      console.log(`Removed ${initialQueueLength - requestQueue.length} requests from queue for client ${clientId}`);
    }

    if (clientId === sillyTavernSocketId) {
      sillyTavernSocketId = null;
      isSillyTavernConnected = false;
      console.log('SillyTavern disconnected.');
    }

    // 启动重试机制
    let attempts = 0;
    const reconnectInterval = setInterval(() => {
      if (socket.connected) {
        clearInterval(reconnectInterval);
        console.log(`Client ${clientId} reconnected.`);
        Rooms.addClientToRoom(clientId, clientId, clientId); //重新连接，重新添加
      } else {
        attempts++;
        if (attempts >= serverSettings.reconnectAttempts) {
          clearInterval(reconnectInterval);
          Rooms.deleteRoom(clientId, clientId);
          console.log(`Client ${clientId} failed to reconnect. Room ${clientId} deleted.`);

          if (sillyTavernSocketId) {
            io.to(sillyTavernSocketId).emit(MSG_TYPE.ERROR, {
              type: MSG_TYPE.ERROR,
              message: `Client ${clientId} disconnected and failed to reconnect. Room deleted.`,
            });
          }
        } else {
          console.log(
            `Client ${clientId} disconnected. Reconnect attempt ${attempts}/${serverSettings.reconnectAttempts}...`,
          );
        }
      }
    }, serverSettings.reconnectDelay);
  });
});

// 静态文件服务
app.use('/lib', express.static(join(__dirname, '../lib')));
app.use('/dist', express.static(join(__dirname, './dist')));
app.use('/example', express.static(join(__dirname, './example')));
app.use('/example/LLM_Role_Play', express.static(join(__dirname, './example/LLM_Role_Play')));
app.use('/example/html', express.static(join(__dirname, './example/LLM_Role_Play/html')));
app.use('/example/json', express.static(join(__dirname, './example/LLM_Role_Play/json')));
app.use('/example/resource', express.static(join(__dirname, './example/LLM_Role_Play/resource')));
app.use('/resource', express.static(join(__dirname, './example/LLM_Role_Play/resource')));
app.use('/public', express.static(join(__dirname, './public')));

// 根路径和 /index.html 返回 monitor.html
app.use('/', (req, res, next) => {
  if (req.path === '/' || req.path === '/index.html') {
    res.sendFile(join(__dirname, 'example', 'monitor', 'monitor.html'));
  } else {
    next();
  }
});

// 404 处理
app.use((req, res) => {
  res.status(404).send('Not Found');
});

const SERVER_PORT = serverSettings.serverPort || 4000;
httpServer.listen(SERVER_PORT, () => {
  console.log(`Server listening on port ${SERVER_PORT}`);
  console.log(`Server monitor: http://localhost:${SERVER_PORT}`);
});
