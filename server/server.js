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
//import * as functionCall from './dist/function_call.js';

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
  reconnectAttempts: 5,
  reconnectDelay: 1000,
  timeout: 5000,
  autoConnect: true,
  socketIOPath: '/socket.io',
  queryParameters: {},
  transport: 'websocket',
  extensionRooms: {}, // 初始化为空对象
  clientKeys: {}, //新增：初始化
  Remember_me: false,
  sillyTavernMasterKey: null, //新增：初始化
};

/**
 * @description 从文件加载服务器设置 / Loads server settings from a file.
 * @function loadServerSettings
 * @returns {void}
 */
function loadServerSettings() {
  try {
    const settingsData = fs.readFileSync(join(__dirname, './settings/server_settings.json'), 'utf-8');
    serverSettings = { ...serverSettings, ...JSON.parse(settingsData) };
    console.log('Server settings loaded from file.');
  } catch (error) {
    console.log('No settings file found or error loading settings. Using default settings.');
    fs.writeFileSync(join(__dirname, './settings/server_settings.json'), JSON.stringify(serverSettings, null, 2), 'utf-8');
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
    fs.writeFileSync(join(__dirname, './settings/server_settings.json'), JSON.stringify(newSettings, null, 2), 'utf-8');
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

// 默认命名空间 (/)
io.on('connection', async (socket) => {
  const clientType = socket.handshake.auth.clientType;
  const clientId = socket.handshake.auth.clientId;

  if (!clientId) {
    console.warn('Client connected without clientId. Disconnecting.');
    socket.disconnect(true);
    return;
  }

  if (clientType === 'monitor') {
    console.log('Monitor client connected');
    socket.join('monitor-room'); // 监控客户端仍然在默认命名空间
  } else if (clientType === 'extension') {
    console.log(`Extension client connected: ${clientId}`);
     // 为扩展分配唯一房间，仅用于保证后续能通过房间找到对应的 socket。  实际的房间管理在 /rooms 命名空间
    socket.join(clientId);
  } else if (clientType === 'extension-Login') { //这个没啥用
    console.log(`Client ${clientId} is Logined.`);
  } else if (clientType === 'extension-checkRememberMe') { //这个也没啥用
    console.log(`Client ${clientId} is checking isRememberMe.`);
  }

  socket.on('disconnect', (reason) => {
    console.log(`Client ${clientId} disconnected: ${reason}`);

    // 注意：这里的重连尝试逻辑 *只* 针对那些 *没有* 在其他命名空间（如 /auth）中处理重连的客户端。
    // 对于 extension 类型的客户端，重连逻辑在 /auth 命名空间中。

    // 启动重试机制 (仅针对 monitor, 因为 extension 在 /auth 中处理)
    // 如果你还有其他类型的客户端需要在默认命名空间中处理，也需要在这里添加重试逻辑。
    if (clientType === 'monitor') {
      let attempts = 0;
      const reconnectInterval = setInterval(() => {
        if (socket.connected) {
          clearInterval(reconnectInterval);
          console.log(`Client ${clientId} reconnected.`);
        } else {
          attempts++;
          if (attempts >= serverSettings.reconnectAttempts) { // 使用 serverSettings
            clearInterval(reconnectInterval);
            console.log(`Client ${clientId} failed to reconnect.`);
          } else {
            console.log(
              `Client ${clientId} disconnected. Reconnect attempt ${attempts}/${serverSettings.reconnectAttempts}...`,
            );
          }
        }
      }, serverSettings.reconnectDelay); // 使用 serverSettings
    }
  });
});

// /auth 命名空间
const authNsp = io.of(NAMESPACES.AUTH);
authNsp.on('connection', async (socket) => {
  const clientType = socket.handshake.auth.clientType;
  const clientId = socket.handshake.auth.clientId;
  const clientKey = socket.handshake.auth.key;
  const clientDesc = socket.handshake.auth.desc;

  // 用于存储重连间隔的映射，键为 clientId
  const reconnectIntervals = {};

  if (clientKey === 'getKey') {
    
  } else {
    if (!(await isValidKey(clientId, clientKey))) {
      // 验证密钥
      console.warn(
        `Client ${clientId} provided invalid key. Disconnecting. socket.handshake.auth:`,
        socket.handshake.auth,
      );
      socket.disconnect(true); // 密钥无效，断开连接
      return;
    }
    // 密钥验证通过，设置房间等
    try {
      Rooms.createRoom(clientId, clientId); // 如果房间已存在，不会报错
      Rooms.addClientToRoom(clientId, clientId, clientId);
      Rooms.setClientDescription(clientId, clientDesc);
      socket.join(clientId); // 加入以 clientId 命名的房间
      console.log(`Client ${clientId} connected and joined room ${clientId}`);
    } catch (error) {
      console.error('Error setting up client:', error);
      // 可以选择向客户端发送错误消息
    }
  }

  // 监听 IDENTIFY_SILLYTAVERN (可以移到 /sillytavern 命名空间)
  socket.on(MSG_TYPE.IDENTIFY_SILLYTAVERN, async (data, callback) => {
    // data: { clientId: string }
    const sillyTavernSocketId = null;
    if (sillyTavernSocketId) {
      // 已经有 SillyTavern 连接了
      console.warn('SillyTavern master key already set. Ignoring new key.');
      if (callback) callback({ status: 'error', message: 'SillyTavern already connected.' }); //更严谨些
      return;
    }
    sillyTavernSocketId = socket.id;
    isSillyTavernConnected = true;
    if (Keys.clientKeys[sillyTavernSocketId]) {
      SILLYTAVERN_key = Keys.clientKeys[sillyTavernSocketId];
    } else {
      SILLYTAVERN_key = Keys.generateAndStoreClientKey(data.clientId);
    }

    //const hashedPassword = await bcrypt.hash(data.key, saltRounds); // saltRounds 要在外部定义
    serverSettings.sillyTavernMasterKey = SILLYTAVERN_key;

    console.log(`SillyTavern identified with socket ID: ${sillyTavernSocketId}`);
    saveServerSettings(serverSettings); // 确保定义了 saveServerSettings
    processLLMRequest(); // 确保定义了 processLLMRequest
    if (callback) callback({ status: 'ok', key: SILLYTAVERN_key });
  });

  // 监听 GET_CLIENT_KEY
  socket.on(MSG_TYPE.GET_CLIENT_KEY, async (data, callback) => {
    if (clientId !== sillyTavernSocketId) {
      if (callback) callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    const targetClientId = data.clientId;
    const key = Keys.getClientKey(targetClientId);
    if (key) {
      if (callback) callback({ status: 'ok', key: key });
    } else {
      if (callback) callback({ status: 'error', message: 'Client key not found.' });
    }
  });

  // 监听 LOGIN
  socket.on(MSG_TYPE.LOGIN, async (data, callback) => {
    //data: {password: string}
    const { clientId, password } = data;

    if (serverSettings.sillyTavernPassword) {
      const func_ReadJsonFromFile = functionRegistry[readJsonFromFile];
      const jsonData = await func_ReadJsonFromFile(`./settings/${clientId}-settings.json`);
      const isMatch = await bcrypt.compare(password, jsonData.sillyTavernMasterKey);
      if (isMatch) {
        if (callback) callback({ success: true });
      } else {
        if (callback) callback({ success: false, message: 'Incorrect password.' });
      }
    } else {
      if (callback) callback({ success: false, message: 'Password not set on server.' });
    }
  });

  // 断开连接
  socket.on('disconnect', reason => {
    const clientId = socket.handshake.auth.clientId; // 在 disconnect 事件中也能获取到

    if (clientId === sillyTavernSocketId) {
      sillyTavernSocketId = null;
      isSillyTavernConnected = false;
      console.log('SillyTavern disconnected.');
    }

    // 启动重试机制 (改进版)
    let attempts = 0;
    // 如果之前有这个 clientId 的重连计时器，先清除
    if (reconnectIntervals[clientId]) {
      clearInterval(reconnectIntervals[clientId]);
      delete reconnectIntervals[clientId];
    }

    const reconnectInterval = setInterval(() => {
      // 检查是否有相同 clientId 的 socket 已经连接
      let alreadyConnected = false;
      authNsp.sockets.forEach(existingSocket => {
        if (existingSocket.handshake.auth.clientId === clientId && existingSocket.id !== socket.id) {
          alreadyConnected = true;
        }
      });

      if (alreadyConnected) {
        clearInterval(reconnectInterval);
        delete reconnectIntervals[clientId];
        console.log(`Client ${clientId} reconnected with a different socket. Stopping retry.`);
        try {
          // 重新加入房间 (如果需要)
          Rooms.addClientToRoom(clientId, clientId, clientId);
        } catch (error) {
          console.error('Error re-adding client to room:', error);
        }
        return; // 提前返回，跳过后续逻辑
      }
      attempts++;
      if (attempts >= serverSettings.reconnectAttempts) {
        clearInterval(reconnectInterval);
        delete reconnectIntervals[clientId]; // 清除计时器
        try {
          // 达到最大重试次数，删除房间
          Rooms.deleteRoom(clientId, clientId);
        } catch (error) {
          console.error('Error deleting room:', error);
        }
        console.log(`Client ${clientId} failed to reconnect. Room ${clientId} deleted.`);

        // 通知 SillyTavern (可以移到 /sillytavern 命名空间)
        if (sillyTavernSocketId) {
          io.of(NAMESPACES.SILLY_TAVERN)
            .to(sillyTavernSocketId)
            .emit(MSG_TYPE.ERROR, {
              type: MSG_TYPE.ERROR,
              message: `Client ${clientId} disconnected and failed to reconnect. Room deleted.`,
            });
        }
      } else {
        console.log(
          `Client ${clientId} disconnected. Reconnect attempt ${attempts}/${serverSettings.reconnectAttempts}...`,
        );
      }
    }, serverSettings.reconnectDelay);

    // 将新的重连计时器添加到映射中
    reconnectIntervals[clientId] = reconnectInterval;
  });
});

// /clients 命名空间
const clientsNsp = io.of(NAMESPACES.CLIENTS);
clientsNsp.on('connection', (socket) => {
  // 监听 GENERATE_CLIENT_KEY, REMOVE_CLIENT_KEY, getClientList, getClientsInRoom
  const clientId = socket.handshake.auth.clientId;
  console.log(`Client ${clientId} connected to ${NAMESPACES.CLIENTS} namespace`);
  socket.on(MSG_TYPE.GET_CLIENT_KEY, async (data, callback) => {
    if (clientId !== sillyTavernSocketId) {
      if (callback) callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    const targetClientId = data.clientId;
    try {
      const key = Keys.clientKeys;
      if (callback && key !== null) {
        callback({ status: 'ok', key: key });
      }
      else {
        callback({ status: 'error', message: 'No keys in stroge!' });
      }
    } catch (error) {
      if (callback) callback({ status: 'error', message: error.message });
    }
  });

  socket.on(MSG_TYPE.GENERATE_CLIENT_KEY, async (data, callback) => {
    if (clientId !== sillyTavernSocketId) {
      if (callback) callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    const targetClientId = data.clientId;
    try {
      const key = await Keys.generateAndStoreClientKey(targetClientId);
      if (callback) callback({ status: 'ok', key: key });
    } catch (error) {
      if (callback) callback({ status: 'error', message: error.message });
    }
  });

  socket.on(MSG_TYPE.REMOVE_CLIENT_KEY, (data, callback) => {
    if (clientId !== sillyTavernSocketId) {
      if (callback) callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    const targetClientId = data.clientId;
    try {
      Keys.removeClientKey(targetClientId);
      if (callback) callback({ status: 'ok' });
    } catch (error) {
      if (callback) callback({ status: 'error', message: error.message });
    }
  });

  socket.on('getClientList', (data, callback) => {
    if (clientId !== sillyTavernSocketId) {
      if (callback) callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    try {
      const clients = [];
      for (const id in Keys.getAllClientKeys()) {
        // 使用 Keys.getAllClientKeys()
        clients.push({
          id,
          description: Rooms.getClientDescription(id), // 获取客户端描述
          // rooms: Keys.getClientRooms(id), // 如果需要，可以包含客户端所属房间
        });
      }
      if (callback) callback(clients);
    } catch (error) {
      if (callback) callback({ status: 'error', message: error.message });
    }
  });

  socket.on('getClientsInRoom', (roomName, callback) => {
    try {
      const clients = io.sockets.adapter.rooms.get(roomName);
      const clientIds = clients
        ? Array.from(clients).filter((id) => id !== undefined)
        : [];

      // 获取客户端的描述信息
      const clientInfo = clientIds.map((id) => {
        const desc = Rooms.getClientDescription(id); // 从 Rooms.js 获取描述
        return { id, description: desc };
      });

      if (callback) callback(clientInfo);
    } catch (error) {
      if (callback) callback({ status: 'error', message: error.message });
    }
  });
});

// /llm 命名空间
const llmNsp = io.of(NAMESPACES.LLM);
llmNsp.on('connection', (socket) => {
  const clientId = socket.handshake.auth.clientId;

  // 监听 LLM_REQUEST, LLM_RESPONSE
  socket.on(MSG_TYPE.LLM_REQUEST, (data) => {
    console.log(`Received LLM request from ${clientId}:`, data);

    const target = data.target;
    if (!canSendMessage(clientId, target)) {
      console.warn(`Client ${clientId} is not allowed to send messages to room ${target}.`);
      return;
    }

    if (target === 'server') {
      // 直接在服务器端处理
      requestQueue.push({
        clientId: clientId,
        requestId: data.requestId,
        message: data.message,
      });
      processLLMRequest(); // 确保定义了 processLLMRequest
    } else {
      // 转发给目标房间
      io.to(target).emit(MSG_TYPE.LLM_REQUEST, data);
    }
  });

  socket.on(MSG_TYPE.LLM_RESPONSE, (data) => {
    console.log(`Received LLM response from ${clientId}:`, data);

    const target = data.target;
    if (!canSendMessage(clientId, target)) {
      console.warn(`Client ${clientId} is not allowed to send messages to room ${target}.`);
      return;
    }

    if (target === 'server') {
      // 直接在服务器端处理
      const originalRequest = requestQueue.find((req) => req.requestId === data.requestId);
      if (originalRequest) {
        io.to(originalRequest.clientId).emit(MSG_TYPE.LLM_RESPONSE, {
          // 发送给原始请求的客户端
          requestId: data.requestId,
          message: data.message,
        });
        processLLMRequest(); // 继续处理队列中的下一个请求
      } else {
        console.warn(`Original request not found for requestId: ${data.requestId}`);
      }
    } else {
      // 转发给目标房间
      io.to(target).emit(MSG_TYPE.LLM_RESPONSE, data);
    }
  });
});

// /sillytavern 命名空间
const sillyTavernNsp = io.of(NAMESPACES.SILLY_TAVERN);
sillyTavernNsp.on('connection', (socket) => {
  const clientId = socket.handshake.auth.clientId;

  // 处理与 SillyTavern 相关的事件，例如 CLIENT_SETTINGS
  socket.on(MSG_TYPE.CLIENT_SETTINGS, (clientSettings) => {
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
    // reinitializeSocketIO(clientSettings); // 暂时不需要, 因为设置都在 settings.json 中
    saveServerSettings(clientSettings); // 使用传入的 clientSettings 更新并保存设置
  });

    // 可以添加其他与 SillyTavern 相关的事件处理程序
    // 例如，处理 SillyTavern 发送的命令或状态更新
});

// /function_call 命名空间
const functionCallNsp = io.of(NAMESPACES.FUNCTION_CALL);
functionCallNsp.on('connection', (socket) => {
  console.log(`Client connected to ${NAMESPACES.FUNCTION_CALL} namespace`);

  // 监听 function_call 事件
  socket.on(MSG_TYPE.FUNCTION_CALL, (data, callback) => {
    // data: { requestId: string, functionName: string, args: any[] }
    console.log(`Received function_call request:`, data);
    handleFunctionCallRequest(socket, data, callback);
  });

  socket.on('disconnect', (reason) => {
    console.log(`Client disconnected from ${NAMESPACES.FUNCTION_CALL} namespace: ${reason}`);
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
