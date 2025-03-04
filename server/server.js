import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { setupServerNonStreamHandlers } from './lib/non_stream.js';
import { setupServerStreamHandlers, forwardStreamData } from './lib/stream.js';
import { NAMESPACES, MSG_TYPE } from './lib/constants.js';
import { uuidv4 } from './lib/uuid/uuid.js';
import { fileURLToPath } from 'url';
import path, { dirname, join } from 'path';
import fs from 'fs';
import * as fss from 'fs/promises';
import bcrypt from 'bcryptjs';
//import * as functionCall from './dist/function_call.js';

import { readJsonFromFile, saveJsonToFile, addStaticResources } from './dist/function_call.js';

// 导入模块
import * as Rooms from './dist/Rooms.js';
import * as Keys from './dist/Keys.js';
//import * as Passwords from './dist/Passwords.js'; // 如果使用了单独的密码文件

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

app.use(express.json());

app.use('/lib', express.static(path.join(__dirname, './lib')));
app.use('/dist', express.static(path.join(__dirname, './dist')));
app.use('/exampleClient', express.static(path.join(__dirname, './exampleClient')));
app.use('/public', express.static(path.join(__dirname, './public')));

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

let tempmap = new Map();

let serverSettings = {
  serverPort: 4000,
  serverAddress: 'http://localhost',
  staticResouce: {},
  reconnectAttempts: 5,
  reconnectDelay: 1000,
  timeout: 5000,
  autoConnect: true,
  socketIOPath: '/socket.io',
  queryParameters: {},
  transport: 'websocket',
  Rooms: [],
  clientKeys: {},
  sillyTavernPassword: new Map(),
  networkSafe: true,
};

let trustedSillyTaverns = new Set();

let trustedClients = new Set();

let sillyTavernkey = new Map();

/**
 * @description 从文件加载服务器设置，自动设置可信客户端/SillyTavern，并确保密码已哈希 / Loads server settings, auto-sets trusted clients/SillyTaverns, and ensures passwords are hashed.
 * @function loadServerSettings
 * @returns {void}
 */
async function loadServerSettings() {
  // 改为 async 函数
  try {
    const settingsData = fs.readFileSync(join(__dirname, './settings/server_settings.json'), 'utf-8');
    const fileSettings = JSON.parse(settingsData);

    // 遍历文件中的设置
    for (const key in fileSettings) {
      // 仅当文件中的值不是 null 或 undefined 时才覆盖
      if (fileSettings[key] !== null && fileSettings[key] !== undefined) {
        serverSettings[key] = fileSettings[key];
      }
    }
    console.log('Server settings loaded from file.');
  } catch (error) {
    console.log('No settings file found or error loading settings. Using default settings.');
    fs.writeFileSync(
      join(__dirname, './settings/server_settings.json'),
      JSON.stringify(serverSettings, null, 2),
      'utf-8',
    );
  }
  let sillyTavernPassword = null;
  // 自动设置可信客户端/SillyTavern
  try {
    const settingsDir = join(__dirname, './settings');
    const files = fs.readdirSync(settingsDir);

    for (const file of files) {
      if (file === 'server_settings.json') {
        continue; // 跳过服务器设置文件
      }

      if (!file.endsWith('.json')) {
        continue; // 跳过非 JSON 文件
      }

      try {
        const filePath = join(settingsDir, file);
        const fileData = fs.readFileSync(filePath, 'utf-8');
        const jsonData = JSON.parse(fileData);
        if (jsonData.hasOwnProperty('clientId') || jsonData.hasOwnProperty('isTrust')) {
          const { clientId, isTrust } = jsonData;
          if (jsonData.hasOwnProperty('sillyTavernPassWord')) {
            sillyTavernPassword = jsonData.sillyTavernPassWord;
          }
          if (isTrust) {
            if (clientId.startsWith('SillyTavern')) {
              trustedSillyTaverns.add(clientId);
              serverSettings.Rooms.push(clientId);
              //console.log('serverSettings.Rooms:', serverSettings.Rooms);
              serverSettings.sillyTavernPassword.set(clientId, sillyTavernPassword);
              //console.log(
              //serverSettings.sillyTavernPassword:',
              //serverSettings.sillyTavernPassword,
              //);
              const stkey = await Keys.generateAndStoreClientKey(clientId);

              sillyTavernkey.set(clientId, stkey);

              console.log(`Added trusted SillyTavern: ${clientId}`);
            } else {
              trustedClients.add(clientId);
              serverSettings.Rooms.push(clientId);
              Keys.generateAndStoreClientKey(clientId);
              console.log(`Added trusted client: ${clientId}`);
            }
          }
        } else {
          console.warn(`Skipping file ${file} due to missing clientId or isTrust property.`);
        }
      } catch (parseError) {
        console.error(`Error parsing JSON in file ${file}:`, parseError);
      }
    }
  } catch (readDirError) {
    console.error('Error reading settings directory:', readDirError);
  }

  // 检查和哈希 SillyTavern 密码
  if (serverSettings.sillyTavernPassword) {
    let passwordsChanged = false; // 标记密码是否被修改
    for (let clientId of serverSettings.sillyTavernPassword.keys()) {
      console.log('clientId:', clientId);
      let passwordEntry = serverSettings.sillyTavernPassword.get(clientId);

      // 检查密码是否已经被哈希 (通过检查是否是字符串且以 $ 开头，这是一个简单的约定)
      if (typeof passwordEntry === 'string' && !passwordEntry.startsWith('$')) {
        // 没有哈希，进行哈希
        const hashedPassword = await bcrypt.hash(passwordEntry, saltRounds);
        serverSettings.sillyTavernPassword.set(clientId, hashedPassword); //直接存储
        passwordsChanged = true;
        saveJsonToFile(`./settings/${clientId}-settings.json`, { sillyTavernMasterKey: hashedPassword });
        console.log(`Hashed password for SillyTavern client: ${clientId}`);
      } else if (
        typeof passwordEntry === 'object' &&
        passwordEntry !== null &&
        passwordEntry.hasOwnProperty('hashed') &&
        passwordEntry.hashed === false
      ) {
        // 兼容旧版本
        const hashedPassword = await bcrypt.hash(passwordEntry.password, saltRounds);
        serverSettings.sillyTavernPassword.set(clientId, hashedPassword); //直接存储
        passwordsChanged = true;
        saveJsonToFile(`./settings/${clientId}-settings.json`, { sillyTavernMasterKey: hashedPassword });
        console.log(`Hashed password for SillyTavern client: ${clientId}`);
      }
    }

    // 如果密码被修改，保存到文件
    if (passwordsChanged) {
      //saveServerSettings(serverSettings);
    }
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

/**
 * @description 处理 LLM 请求 / Processes the LLM request.
 * @function processLLMRequest
 * @param {string} target - 目标 SillyTavern 实例的 clientId / Target SillyTavern client ID.
 * @param {object} request - 请求对象 / Request object.
 * @returns {void}
 */
function processLLMRequest(target, request) {
  if (trustedSillyTaverns.has(target)) {
    io.of(NAMESPACES.SILLY_TAVERN).to(target).emit(MSG_TYPE.LLM_REQUEST, request);
    console.log(`Forwarding LLM request to SillyTavern: ${target}`);
  } else {
    console.warn(`Target SillyTavern not found: ${target}`);
    // 可以选择向请求的发起者发送错误消息
    if (request.clientId) {
      // 确保请求包含 clientId
      io.of(NAMESPACES.AUTH)
        .to(request.clientId)
        .emit(MSG_TYPE.ERROR, {
          // 假设错误消息发送回 /auth
          type: MSG_TYPE.ERROR,
          message: `Target SillyTavern not found: ${target}`,
          requestId: request.requestId, // 包含请求 ID
        });
    }
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
import { error } from 'console';
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
  if (trustedSillyTaverns.has(clientId)) {
    // 如果是 SillyTavern，从 Keys 中获取并验证
    const storedKey = Keys.getClientKey(clientId);
    if (!storedKey) {
      return false; // 没有找到密钥
    }
    return await bcrypt.compare(String(key), storedKey);
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

  if (targetRoom === String(senderClientId))
    if (trustedSillyTaverns.has(senderClientId)) {
      return true;
    }

  // 使用 Rooms.isClientInRoom() 检查客户端是否在房间内
  if (Rooms.isClientInRoom(senderClientId, targetRoom)) {
    return true;
  }

  return false;
}

const reconnectIntervals = new Map();

function handleReconnect(socket, clientId, clientType) {
  let attempts = 0;

  // 清除之前的重连间隔（如果存在）
  if (reconnectIntervals.has(clientId)) {
    clearInterval(reconnectIntervals.get(clientId));
    reconnectIntervals.delete(clientId);
  }

  const reconnectInterval = setInterval(() => {
    // 检查是否有相同 clientId 的其他 socket 已经连接
    let alreadyConnected = false;
    authNsp.sockets.forEach(existingSocket => {
      //这里要用.auth，而不是.handshake.auth
      if (existingSocket.auth.clientId === clientId && existingSocket.id !== socket.id) {
        alreadyConnected = true;
      }
    });

    if (alreadyConnected) {
      clearInterval(reconnectInterval);
      reconnectIntervals.delete(clientId);
      console.log(`Client ${clientId} reconnected with a different socket. Stopping retry.`);

      // 尝试将客户端重新添加到房间（如果需要）
      try {
        Rooms.addClientToRoom(socket, clientId); // 假设你的房间名与 clientId 相同
      } catch (error) {
        console.error('Error re-adding client to room:', error);
      }
      // 重新连接成功也清理旧的 socket
      cleanUpSocket(socket);
      return;
    }

    attempts++;
    if (attempts >= serverSettings.reconnectAttempts) {
      clearInterval(reconnectInterval);
      reconnectIntervals.delete(clientId);

      // 重试失败，执行清理
      cleanUpSocket(socket); // 清理 socket

      // 删除房间（如果需要）
      try {
        Rooms.deleteRoom(socket, clientId); // 假设你的房间名与 clientId 相同
        console.log(`Client ${clientId} failed to reconnect. Room ${clientId} deleted.`);
      } catch (error) {
        console.error('Error deleting room:', error);
      }

      // 通知所有 SillyTavern 实例 (可选，根据你的逻辑)
      trustedSillyTaverns.forEach(stClientId => {
        io.of(NAMESPACES.SILLY_TAVERN)
          .to(stClientId)
          .emit(MSG_TYPE.ERROR, {
            type: MSG_TYPE.ERROR,
            message: `Client ${clientId} disconnected and failed to reconnect. Room deleted.`,
          });
      });
    } else {
      console.log(
        `Client ${clientId} disconnected. Reconnect attempt ${attempts}/${serverSettings.reconnectAttempts}...`,
      );
    }
  }, serverSettings.reconnectDelay);

  reconnectIntervals.set(clientId, reconnectInterval);
}

// 清理 socket 的函数
function cleanUpSocket(socket) {
  try {
    // 从所有房间中移除 socket
    if (socket.rooms) {
      for (const room of socket.rooms) {
        if (room !== socket.handshake.auth.clientId) {
          // 不移除自身的房间
          socket.leave(room);
        }
      }
    }
    // 从 Socket.IO 的内部数据结构中移除 socket
    if (socket.nsp && socket.nsp.sockets) {
      socket.nsp.sockets.delete(socket.id);
    }

    socket.disconnect(true);

    console.log(`Socket ${socket.handshake.auth.clientType} cleaned up.`);
  } catch (error) {
    console.error('cleanUpSocket error', error);
  }
}

/**
 * 通用身份验证函数
 * @param {Socket} socket - Socket.IO 的 socket 对象
 * @param {boolean} [skipNetworkSafeCheck=false] - 是否跳过 networkSafe 检查 (用于 getKey)
 * @returns {boolean | object} - 验证通过返回 true; 未通过返回 false 或带有错误信息的对象 (用于回调)
 */
async function checkAuth(socket, skipNetworkSafeCheck = serverSettings.networkSafe) {
  const clientId = socket.handshake.auth.clientId;
  const clientKey = socket.handshake.auth.key;

  // 1. networkSafe 模式检查
  if (
    skipNetworkSafeCheck &&
    serverSettings.networkSafe &&
    (trustedClients.has(clientId) || trustedSillyTaverns.has(clientId))
  ) {
    console.warn(`Network safe mode is enabled. Skipping authentication for client: ${clientId}`);
    return true; // 网络安全模式下直接通过
  }

  // 2. 客户端信任检查
  if (!trustedClients.has(clientId) || !trustedSillyTaverns.has(clientId)) {
    console.warn(`Client ${clientId} is not trusted.`);
    console.log('trustedSillyTaverns:', trustedClients);
    return { status: 'error', message: 'Client is not trusted.' }; // 返回错误对象
  }

  // 3. 密钥验证 (getKey 除外)
  if (clientKey !== 'getKey' && !(await isValidKey(clientId, clientKey))) {
    console.warn(`Client ${clientId} provided invalid key.`);
    return { status: 'error', message: 'Invalid key.' }; // 返回错误对象
  }

  return true; // 所有检查通过
}

// 默认命名空间 (/)
io.on('connection', async socket => {
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
  } else if (clientType === 'extension-Login') {
    //这个没啥用
    console.log(`Client ${clientId} is Logined.`);
  } else if (clientType === 'extension-checkRememberMe') {
    //这个也没啥用
    console.log(`Client ${clientId} is checking isRememberMe.`);
  }

  socket.on('disconnect', reason => {
    console.log(`Client ${clientId} disconnected: ${reason.reason}`);

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
          if (attempts >= serverSettings.reconnectAttempts) {
            // 使用 serverSettings
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

let connectedClients = new Map(); // 存储已连接的可信客户端

// /auth 命名空间
const authNsp = io.of(NAMESPACES.AUTH);

authNsp.on('connection_error', err => {
  console.error('Connection Error (authNsp):', {
    message: err.message,
    code: err.code, // Socket.IO 错误代码
    description: err.description, // 错误描述
    context: err.context, // 错误发生的上下文信息
    socketId: err.socket ? err.socket.id : 'N/A',
    clientId:
      err.socket && err.socket.handshake && err.socket.handshake.auth ? err.socket.handshake.auth.clientId : 'N/A',
    clientType:
      err.socket && err.socket.handshake && err.socket.handshake.auth ? err.socket.handshake.auth.clientType : 'N/A',
    timestamp: new Date().toISOString(),
  });
  if (err.message === 'parse error') {
    const socket = err.socket;
    cleanUpSocket(socket);
  }
});

authNsp.on('disconnect', err => {
  console.error('Connection disconnect (authNsp):', {
    message: err.message,
    code: err.code, // Socket.IO 错误代码
    description: err.description, // 错误描述
    context: err.context, // 错误发生的上下文信息
    socketId: err.socket ? err.socket.id : 'N/A',
    clientId:
      err.socket && err.socket.handshake && err.socket.handshake.auth ? err.socket.handshake.auth.clientId : 'N/A',
    clientType:
      err.socket && err.socket.handshake && err.socket.handshake.auth ? err.socket.handshake.auth.clientType : 'N/A',
    timestamp: new Date().toISOString(),
  });
  if (err.message === 'parse error') {
    const socket = err.socket;
    cleanUpSocket(socket);
  }
});

authNsp.on('connection', async socket => {
  const clientType = socket.handshake.auth.clientType;
  const clientId = socket.handshake.auth.clientId;
  const clientKey = socket.handshake.auth.key;
  const clientDesc = socket.handshake.auth.desc;

  const authResult = await checkAuth(socket);

  console.log('authResult:', authResult);

  if (authResult !== true) {
    // 验证失败
    if (typeof authResult === 'object' && authResult.status === 'error') {
      // 统一所有callback的调用形式
      socket.emit(MSG_TYPE.ERROR, { message: authResult.message }); // 错误消息
    }
    socket.disconnect(true);
    return;
  }

  // 可信客户端 (包括 SillyTavern)
  if (clientKey === 'getKey' && trustedSillyTaverns.has(clientId)) {
    // 密钥验证通过，设置房间
    try {
      Rooms.createRoom(socket, clientId);
      Rooms.addClientToRoom(socket, clientId);
      Rooms.setClientDescription(clientId, clientDesc);
      socket.join(clientId);
      console.log(`Client ${clientId} connected and joined room ${clientId}`);
    } catch (error) {
      console.error('Error setting up client:', error);
      // 发送错误消息 (指定目标房间)
      socket.to(clientId).emit(MSG_TYPE.ERROR, { message: 'Error setting up client.' });
      socket.disconnect(true);
    }
  }

  if (trustedClients.has(clientId)) {
    Rooms.createRoom(socket, clientId);
    Rooms.addClientToRoom(socket, clientId);
    Rooms.setClientDescription(clientId, clientDesc);
    socket.join(clientId);
    console.log(`Client ${clientId} connected and joined room ${clientId}`);
    Keys.generateAndStoreClientKey(clientId);

    if (clientKey === 'getKey' && serverSettings.networkSafe) {
      socket.emit(MSG_TYPE.CLIENT_KEY, { Key: Keys.getClientKey(clientId) });
    }

    connectedClients.set(clientId, { id: clientId, description: clientDesc });

    let targetSocket = null;
    authNsp.sockets.forEach(existingSocket => {
      // 遍历当前命名空间下的所有 socket
      if (existingSocket.handshake.auth.clientId.startsWith('SillyTavern')) {
        targetSocket = existingSocket;
        sendConnectedClientsToSillyTavern(targetSocket); // 发送更新
      }
    });
  }

  setupSocketListeners(socket); //设置监听器
});

function setupSocketListeners(socket) {
  // 监听 GET_CLIENT_KEY (仅限 SillyTavern)
  socket.on(MSG_TYPE.GET_CLIENT_KEY, async (data, callback) => {
    if (!trustedSillyTaverns.has(socket.handshake.auth.clientId)) {
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

  let STSocket = [];
  socket.on(MSG_TYPE.GET_SILLYTAVERN_EXTENSION, callback => {
    llmNsp.sockets.forEach(existingSocket => {
      if (existingSocket.handshake.auth.clientId.startsWith('SillyTavern')) {
        STSocket.push(existingSocket.handshake.auth.clientId);
      }
    });
    if (callback) {
      if (STSocket) {
        callback({ status: 'ok', allTheSTSocket: STSocket });
      }
      callback({ status: 'error', reason: 'No connected SillyTavern extension!' });
    }
  });

  // 监听 LOGIN(暂时放弃)
  socket.on(MSG_TYPE.LOGIN, async (data, callback) => {
    const { clientId, password } = data;
    console.log('Received login request from:', clientId, 'data:', data);

    if (!clientId || !password) {
      console.warn('Invalid login data received:', data);
      if (callback) callback({ success: false, message: 'Invalid login data.' });
      return;
    }

    if (serverSettings.sillyTavernPassword) {
      try {
        const jsonData = await readJsonFromFile(`./settings/${clientId}-settings.json`);
        console.log('jsonData.result.sillyTavernMasterKey:', jsonData.result.sillyTavernMasterKey);

        const isMatch = await bcrypt.compare(password, jsonData.result.sillyTavernMasterKey);

        if (isMatch) {
          console.log('Password matched for client:', clientId);
          if (callback) callback({ success: true });
        } else {
          console.warn('Password mismatch for client:', clientId);
          if (callback) callback({ success: false, message: 'Incorrect password.' });
        }
      } catch (error) {
        console.error('Error during login process:', error);
        if (callback) callback({ success: false, message: 'Server error during login.' });
      }
    } else {
      console.log('Password not set on server.');
      if (callback) callback({ success: false, message: 'Password not set on server.' });
    }
  });

  socket.on('disconnect', reason => {
    console.log(`Client disconnected from ${NAMESPACES.AUTH} namespace: ${reason}`);

    if (connectedClients.has(socket.handshake.auth.clientId)) {
      connectedClients.delete(socket.handshake.auth.clientId);
      sendConnectedClientsToSillyTavern(); // 发送更新
    }

    cleanUpSocket(socket);
  });

  socket.on('error', error => {
    console.error('Socket error:', error);
    if (error.message === 'parse error') {
      cleanUpSocket(socket);
    }
  });

  // 客户端主动断开 (CLIENT_DISCONNECTED)
  socket.on(MSG_TYPE.CLIENT_DISCONNETED, reason => {
    const clientId = socket.handshake.auth.clientId;
    const clientType = socket.handshake.auth.clientType;
    console.log(`Client ${clientId}-${clientType}-authNsp disconnected by client side. Reason: ${reason.reason}`);
    cleanUpSocket(socket);
  });
}

// /clients 命名空间
const clientsNsp = io.of(NAMESPACES.CLIENTS);
clientsNsp.on('connection', async socket => {
  // 监听 GENERATE_CLIENT_KEY, REMOVE_CLIENT_KEY, getClientList, getClientsInRoom
  const clientId = socket.handshake.auth.clientId;
  console.log(`Client ${clientId} connected to ${NAMESPACES.CLIENTS} namespace`);

  const authResult = await checkAuth(socket);

  if (authResult !== true) {
    // 验证失败
    if (typeof authResult === 'object' && authResult.status === 'error') {
      // 统一所有callback的调用形式
      socket.emit(MSG_TYPE.ERROR, { message: authResult.message }); // 错误消息
    }
    socket.disconnect(true);
    return;
  }

  // 新增：获取所有客户端密钥
  socket.on(MSG_TYPE.GET_ALL_CLIENT_KEYS, (data, callback) => {
    if (!trustedSillyTaverns.has(clientId)) {
      if (callback) callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    try {
      const keys = Keys.getAllClientKeys(); // 从 Keys.js 获取所有密钥
      if (callback) callback({ status: 'ok', keys: keys });
    } catch (error) {
      if (callback) callback({ status: 'error', message: error.message });
    }
  });

  socket.on(MSG_TYPE.GET_CLIENT_KEY, async (data, callback) => {
    if (!trustedSillyTaverns.has(clientId)) {
      if (callback) callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    const targetClientId = data.clientId;
    try {
      //const key = Keys.clientKeys; //不能直接这么给，要用函数
      const key = Keys.getClientKey(targetClientId);
      if (callback && key !== null) {
        callback({ status: 'ok', key: key });
      } else {
        callback({ status: 'error', message: 'No keys in stroge!' });
      }
    } catch (error) {
      if (callback) callback({ status: 'error', message: error.message });
    }
  });

  socket.on(MSG_TYPE.GENERATE_CLIENT_KEY, async (data, callback) => {
    if (!trustedSillyTaverns.has(clientId)) {
      if (callback) callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    const targetClientId = data.targetClientId;
    try {
      const key = await Keys.generateAndStoreClientKey(targetClientId);

      if (callback) callback({ status: 'ok', key: key });
    } catch (error) {
      if (callback) callback({ status: 'error', message: error.message });
    }
  });

  socket.on(MSG_TYPE.REMOVE_CLIENT_KEY, (data, callback) => {
    if (!trustedSillyTaverns.has(clientId)) {
      if (callback) callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    const targetClientId = data.targetClientId;
    try {
      Keys.removeClientKey(targetClientId);
      if (callback) callback({ status: 'ok' });
    } catch (error) {
      if (callback) callback({ status: 'error', message: error.message });
    }
  });

  // 新增：监听客户端请求更新 connectedClients
  socket.on(MSG_TYPE.UPDATE_CONNECTED_CLIENTS, (data, callback) => {
    if (!trustedSillyTaverns.has(clientId)) {
      if (callback) callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    console.log('Update Client List Requested!');
    const clientList = Array.from(connectedClients.values());
    if (callback) callback({ status: 'ok', clients: clientList });
  });

  socket.on('getClientList', (data, callback) => {
    if (!trustedSillyTaverns.has(clientId)) {
      if (callback) callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    try {
      const clients = [];
      const allClientKeys = Keys.getAllClientKeys(); // 获取所有客户端密钥

      for (const id in allClientKeys) {
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
      const clientIds = clients ? Array.from(clients).filter(id => id !== undefined) : [];

      // 获取客户端的描述信息
      const clientInfo = clientIds.map(id => {
        const desc = Rooms.getClientDescription(id); // 从 Rooms.js 获取描述
        return { id, description: desc };
      });

      if (callback) callback(clientInfo);
    } catch (error) {
      if (callback) callback({ status: 'error', message: error.message });
    }
  });

  socket.on('disconnect', reason => {
    console.log(`Client disconnected from ${NAMESPACES.CLIENTS} namespace: ${reason.reason}`);
    cleanUpSocket(socket);
  });

  socket.on(MSG_TYPE.CLIENT_DISCONNETED, reason => {
    const clientId = socket.handshake.auth.clientId;
    const clientType = socket.handshake.auth.clientType;

    console.log(`Client ${clientId}-${clientType}-ClientNsp disconnected. Reason: ${reason.reason}`);

    cleanUpSocket(socket);
  });
});

// 函数：向所有可信的 SillyTavern 扩展发送 connectedClients
function sendConnectedClientsToSillyTavern(targetSocket) {
  const clientList = Array.from(connectedClients.values()); // 转换为数组
  //console.log("clientList", clientList)
  targetSocket.emit(MSG_TYPE.CONNECTED_CLIENTS_UPDATE, { clients: clientList }); // 使用 clientsNsp
}

// /llm 命名空间
const llmNsp = io.of(NAMESPACES.LLM);

// 用于存储请求的映射关系： { [requestId]: [ { target: string, clientId: string }, ... ] }
const llmRequests = {};

llmNsp.on('connection', async socket => {
  const clientId = socket.handshake.auth.clientId;

  const authResult = await checkAuth(socket);

  if (authResult !== true) {
    // 验证失败
    if (typeof authResult === 'object' && authResult.status === 'error') {
      // 统一所有callback的调用形式
      socket.emit(MSG_TYPE.ERROR, { message: authResult.message }); // 错误消息
    }
    socket.disconnect(true);
    console.error('验证失败!');
    return;
  }

  // 监听 LLM_REQUEST
  socket.on(MSG_TYPE.LLM_REQUEST, (data, callback) => {
    // 添加 callback 参数
    console.log(`Received LLM request from ${clientId}:`, data);

    const target = data.target;
    const requestId = data.requestId;

    if (!canSendMessage(clientId, target)) {
      console.warn(`Client ${clientId} is not allowed to send messages to room ${target}.`);
      if (callback) {
        // 使用 callback 返回错误
        callback({
          status: 'error',
          message: `Client ${clientId} is not allowed to send messages to room ${target}.`,
        });
      }
      return;
    }

    if (target === 'server') {
      console.warn(`LLM requests should not be sent to the server directly.`);
      if (callback) {
        // 使用 callback 返回错误
        callback({
          status: 'error',
          message: 'LLM requests should not be sent to the server directly.',
        });
      }
      return;
    }

    // 查找目标客户端
    let targetSocket = null;
    llmNsp.sockets.forEach(existingSocket => {
      // 遍历当前命名空间下的所有 socket
      if (existingSocket.handshake.auth.clientId === target) {
        targetSocket = existingSocket;
      }
    });

    if (targetSocket) {
      // 找到目标客户端，转发请求
      targetSocket.emit(MSG_TYPE.LLM_REQUEST, data);
      console.log(`Forwarded LLM request to target client: ${target}`);

      // 存储请求的映射关系 (只有在找到目标客户端时才存储)
      if (!llmRequests[requestId]) {
        llmRequests[requestId] = [];
      }
      llmRequests[requestId].push({ target, clientId });

      if (callback) {
        // 可选: 发送成功回执
        callback({ status: 'ok', message: 'Request forwarded.' });
      }
    } else {
      // 未找到目标客户端，返回错误
      console.warn(`Target client not found: ${target}`);
      if (callback) {
        // 使用 callback 返回错误
        callback({
          status: 'error',
          message: `Target client not found: ${target}`,
        });
      }
    }
  });

  socket.on('disconnect', reason => {
    console.log(`Client disconnected from ${NAMESPACES.LLM} namespace: ${reason}`);
    cleanUpSocket(socket);
  });

  socket.on(MSG_TYPE.CLIENT_DISCONNETED, reason => {
    const clientId = socket.handshake.auth.clientId;
    const clientType = socket.handshake.auth.clientType;

    console.log(`Client ${clientId}-${clientType}-llmNsp disconnected. Reason: ${reason.reason}`);

    cleanUpSocket(socket);
  });
});

setupServerStreamHandlers(io, NAMESPACES.LLM, llmRequests);
setupServerNonStreamHandlers(io, NAMESPACES.LLM, llmRequests);

// /sillytavern 命名空间
const sillyTavernNsp = io.of(NAMESPACES.SILLY_TAVERN);
sillyTavernNsp.on('connection', async socket => {
  const clientId = socket.handshake.auth.clientId;

  const authResult = await checkAuth(socket);

  if (authResult !== true) {
    // 验证失败
    if (typeof authResult === 'object' && authResult.status === 'error') {
      // 统一所有callback的调用形式
      socket.emit(MSG_TYPE.ERROR, { message: authResult.message }); // 错误消息
    }
    socket.disconnect(true);
    return;
  }

  // 处理与 SillyTavern 相关的事件，例如 CLIENT_SETTINGS
  socket.on(MSG_TYPE.CLIENT_SETTINGS, clientSettings => {
    // 验证发送者是否是 SillyTavern 扩展
    if (trustedSillyTaverns.has(clientId)) {
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

  let toSendKey = null;

  // 监听 IDENTIFY_SILLYTAVERN
  socket.on(MSG_TYPE.IDENTIFY_SILLYTAVERN, async (data, callback) => {
    // data: { clientId: string }'

    if (trustedSillyTaverns.has(data.clientId)) {
      console.warn('SillyTavern master key already set. Ignoring new key and send old key.');
      if (sillyTavernkey.has(data.clientId)) {
        toSendKey = sillyTavernkey.get(data.clientId);
      }
      if (callback) callback({ status: 'warning', message: 'SillyTavern already connected.', key: toSendKey }); //更严谨些
      return;
    } else {
      // 添加到可信 SillyTavern 集合
      trustedSillyTaverns.add(data.clientId);

      let SILLYTAVERN_key; // 为每个 SillyTavern 实例单独生成密钥
      if (Keys.clientKeys[socket.id]) {
        // 检查是否已存在密钥（不太可能，但以防万一）
        SILLYTAVERN_key = Keys.clientKeys[socket.id];
      } else {
        SILLYTAVERN_key = Keys.generateAndStoreClientKey(data.clientId);
      }
      //serverSettings.sillyTavernMasterKey = SILLYTAVERN_key; // 存储密钥（可选，取决于你如何使用）

      console.log(`SillyTavern identified with socket ID: ${socket.id} and clientId: ${data.clientId}`);
      saveServerSettings(serverSettings);
      //processLLMRequest();
      if (callback) callback({ status: 'ok', key: SILLYTAVERN_key });
    }
  });

  socket.on('disconnect', reason => {
    console.log(`Client disconnected from ${NAMESPACES.SILLY_TAVERN} namespace: ${reason.reason}`);
    cleanUpSocket(socket);
  });

  socket.on(MSG_TYPE.CLIENT_DISCONNETED, reason => {
    const clientId = socket.handshake.auth.clientId;
    const clientType = socket.handshake.auth.clientType;

    console.log(`Client ${clientId}-${clientType}-sillyTavernNsp disconnected. Reason: ${reason.reason}`);

    cleanUpSocket(socket);
  });
});

// /function_call 命名空间
const functionCallNsp = io.of(NAMESPACES.FUNCTION_CALL);
functionCallNsp.on('connection', async socket => {
  console.log(`Client connected to ${NAMESPACES.FUNCTION_CALL} namespace`);

  const authResult = await checkAuth(socket);
  if (authResult !== true) {
    // 验证失败
    if (typeof authResult === 'object' && authResult.status === 'error') {
      // 统一所有callback的调用形式
      socket.emit(MSG_TYPE.ERROR, { message: authResult.message }); // 错误消息
    }
    socket.disconnect(true);
    return;
  }

  // 监听 function_call 事件
  socket.on(MSG_TYPE.FUNCTION_CALL, (data, callback) => {
    // data: { requestId: string, functionName: string, args: any[] }
    console.log(`Received function_call request:`, data);
    handleFunctionCallRequest(socket, data, callback);
  });

  socket.on('disconnect', reason => {
    console.log(`Client disconnected from ${NAMESPACES.FUNCTION_CALL} namespace: ${reason.reason}`);
    cleanUpSocket(socket);
  });

  socket.on(MSG_TYPE.CLIENT_DISCONNETED, reason => {
    const clientId = socket.handshake.auth.clientId;
    const clientType = socket.handshake.auth.clientType;

    console.log(`Client ${clientId}-${clientType}-functionCallNsp disconnected. Reason: ${reason.reason}`);

    cleanUpSocket(socket);
  });
});

// 初始静态资源映射 (URL 路径 -> 相对于 server.js 的文件系统路径)
const initialResources = {
  '/lib': './lib',
  '/dist': './dist',
  '/exampleClient': './exampleClient',
  '/public': './public',
};

// 在应用启动时，加载初始静态资源到内存
async function initializeStaticResources() {
  try {
    for (const urlPath in initialResources) {
      if (initialResources.hasOwnProperty(urlPath)) {
        const basePath = path.join(__dirname, initialResources[urlPath]);

        // 递归遍历目录的函数
        async function addResourcesRecursively(currentPath, currentUrlPath) {
          const entries = await fss.readdir(currentPath, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);
            const relativeUrl = path.join(currentUrlPath, entry.name);

            if (entry.isDirectory()) {
              // 如果是目录，递归调用
              await addResourcesRecursively(fullPath, relativeUrl);
            } else {
              // 如果是文件, 调用addStaticResources, 注意这里是单个文件，所以可以直接构造字典
              await addStaticResources(app, {
                [relativeUrl]: path.relative(path.join(__dirname, 'dist', '..'), fullPath),
              }); //path.relative得到相对于项目根目录的路径
            }
          }
        }

        await addResourcesRecursively(basePath, urlPath);
      }
    }
    console.log('Initial static resources added successfully.');
  } catch (error) {
    console.error('Error initializing static resources:', error);
    process.exit(1);
  }
}

// 根路径和 /index.html 返回 monitor.html
app.use('/', (req, res, next) => {
  if (req.path === '/' || req.path === '/index.html') {
    res.sendFile(join(__dirname, 'exampleClient', 'monitor', 'monitor.html'));
  } else {
    next();
  }
});

// 404 处理
app.use((req, res) => {
  res.status(404).send('Not Found');
});

initializeStaticResources().then(() => {
  const SERVER_PORT = serverSettings.serverPort || 4000;
  httpServer.listen(SERVER_PORT, () => {
    console.log(`Server listening on port ${SERVER_PORT}`);
    console.log(`Server monitor: http://localhost:${SERVER_PORT}`);
  });
});
