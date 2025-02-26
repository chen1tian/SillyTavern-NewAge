//index_NewAge.js

import { MSG_TYPE, STREAM_EVENTS, NAMESPACES } from './lib/constants.js';
import { io } from './lib/Socket.io/socket.io.js';
import { uuidv4 } from './lib/uuid/uuid.js';
import { eventSource, event_types } from '../../../../script.js';
import { loadFileToDocument, delay } from '../../../../scripts/utils.js';
import * as messageForwarder from './dist/message_forwarder.js';
import { handleIframe } from './dist/iframe_server/index.js';

// 导入前端助手的所有注册函数
import { registerIframeChatMessageHandler } from './dist/iframe_server/chat_message.js';
import { registerIframeDisplayedMessageHandler } from './dist/iframe_server/displayed_message.js';
import { registerIframeEventHandler } from './dist/iframe_server/event.js';
import { registerIframeFrontendVersionHandler } from './dist/iframe_server/frontend_version.js';
import { registerIframeGenerateHandler, fromGenerateRawConfig, iframeGenerate } from './dist/iframe_server/generate.js';
import { registerIframeLorebookHandler } from './dist/iframe_server/lorebook.js';
import { registerIframeLorebookEntryHandler } from './dist/iframe_server/lorebook_entry.js';
import { registerIframeSlashHandler } from './dist/iframe_server/slash.js';
import { registerIframeTavernRegexHandler } from './dist/iframe_server/tavern_regex.js';
import { registerIframeUtilHandler } from './dist/iframe_server/util.js';
import { registerIframeVariableHandler } from './dist/iframe_server/variables.js';

// 导入房间管理函数
import { addClientToRoom, removeClientFromRoom } from './dist/Rooms.js';
//import { clientKeys } from './server/dist/Keys.js';

const extensionName = 'SillyTavern-NewAge';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

let socket = null; // 用于主要的连接 (认证, 获取初始信息)
let tempMainSocket = null;
let llmSocket = null; // 用于 LLM 请求/响应
let functionCallSocket = null; // 用于 function_call
let roomsSocket = null;
let clientsSocket = null;
let authSocket = null;
let sillyTavernSocket = null; // 如果需要与 /sillytavern 命名空间交互

let streamBuffer = [];
let isStreaming = false;
let logCounter = 0;

// 新增：请求队列
const llmRequestQueue = [];
const functionCallQueue = [];
let isProcessingRequest = false; // 标志：是否有请求正在处理中

let isRemembered = false;
let clientId = generateClientId();  // 声明 clientId
let clientDesc; //声明clientDesc
let fullServerAddress = 'http://localhost:4000'; //声明 fullServerAddress

/**
 * @description 创建并配置 Socket.IO 连接
 * @param {string} namespace - 命名空间
 * @param {object} authData - 认证数据
 * @param {boolean} [autoConnect=true] - 是否自动连接
 * @returns {initSocket} - Socket.IO 连接实例
 */
function createSocket(namespace, authData, autoConnect = true) {
  const initSocket = io(fullServerAddress + namespace, {
    auth: authData,
    clientId: clientId,
    autoConnect: autoConnect,
  });

   // 通用错误处理
  initSocket.on('connect_error', error => {
    addLogMessage('fail', `[${namespace}] 连接错误: ${error}`, 'client');
    console.error(`Socket.IO [${namespace}]: Connection error`, error);
    toastr.error(`[${namespace}] 连接错误: ${error}`, 'Socket.IO');
  });

  initSocket.on('disconnect', reason => {
    addLogMessage('warning', `[${namespace}] 与服务器断开连接: ${reason}`, 'client');
    console.log(`Socket.IO [${namespace}]: Disconnected, reason: ${reason}`);
    toastr.warning(`[${namespace}] 已断开连接: ${reason}`, 'Socket.IO');
  });
  return initSocket;
}

/**
 * @description 断开所有 Socket.IO 连接
 */
function disconnectAllSockets() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    if (llmSocket) {
        llmSocket.disconnect();
        llmSocket = null;
    }
    if (functionCallSocket) {
        functionCallSocket.disconnect();
        functionCallSocket = null;
    }
    if (roomsSocket) {
        roomsSocket.disconnect();
        roomsSocket = null;
    }
    if(clientsSocket){
        clientsSocket.disconnect();
        clientsSocket = null;
    }
    // if (sillyTavernSocket) { // 如果有
    //     sillyTavernSocket.disconnect();
    //     sillyTavernSocket = null;
    // }
  updateButtonState(false); // 更新按钮状态
  $('#socketio-testBtn').prop('disabled', true); // 禁用测试按钮
}

/**
 * @description 处理登录点击事件 / Handles the login click event.
 * @async
 * @function onLoginClick
 * @returns {Promise<void>}
 */
async function onLoginClick() {
    const password = $('#socketio-password').val();
    const rememberMe = $('#socketio-rememberMe').is(':checked');
  
    // 使用默认命名空间进行登录
    const loginSocket = createSocket(NAMESPACES.AUTH, {
      clientType: 'extension-Login',
      clientId: clientId,
      desc: clientDesc,
      key: 'getKey'
    }, false); // 不自动连接

    loginSocket.connect(); // 手动连接

    console.log('loginSocket', loginSocket);

    loginSocket.emit(MSG_TYPE.LOGIN, { clientId , password }, (response) => {
      if (response.success) {
        $('#login-form').hide();
        $('#login-message').text('').removeClass('error');
        $('.button-group').show();
        $('.animated-details').show();
  
        if (rememberMe) {

          // 使用 function_call 命名空间
          const rememberMeSocket = createSocket(NAMESPACES.FUNCTION_CALL, {
            clientType: 'extension_FUNCTION_CALL',
            clientId: clientId,
            desc: clientDesc,
          },false);

        rememberMeSocket.connect(); // 手动连接
          rememberMeSocket.emit(
            MSG_TYPE.FUNCTION_CALL,
            {
              requestId: 'rememberMe',
              target: 'server',
              functionName: 'saveJsonToFile',
              args: [`./settings/${clientId}-settings.json`, { Remember_me: true }],
            },
            response => {
              if (response.success) {
                console.log('"Remember_me" saved.');
              } else {
                console.error('Failed to save "Remember_me":', response.error);
                toastr.error('Failed to save "Remember_me".', 'Error');
              }
              rememberMeSocket.disconnect();
            },
          );

        }
        connectToServer(); // 登录成功后自动连接
        loginSocket.disconnect(); // 登录成功，断开登录用的 socket

      } else {
        $('#login-message')
          .text(response.message || 'Login failed.')
          .addClass('error');
        loginSocket.disconnect();
      }
    });
}

/**
 * @description 检查是否记住登录 / Checks if login is remembered.
 * @async
 * @function checkRememberMe
 * @returns {Promise<void>}
 */
async function checkRememberMe() {
  // 使用 function_call 命名空间
  const tempSocket = createSocket(
    NAMESPACES.FUNCTION_CALL,
    {
      clientType: 'extension-checkRememberMe',
      clientId: clientId,
      desc: clientDesc,
    },
    false,
  ); // 不自动连接

  tempSocket.connect(); // 手动连接

  tempSocket.on('connect', () => {
    console.log('checking Remember_me.');
    tempSocket.emit(
      MSG_TYPE.FUNCTION_CALL,
      {
        requestId: 'checkRememberMe',
        target: 'server',
        functionName: 'readJsonFromFile',
        args: [`./settings/${clientId}-settings.json`],
      },
      response => {
        if (response.success) {
          const settings = response.result;
          //console.log('settings:', settings);
          if (settings.result.Remember_me === true) {
            // 记住登录，自动连接
            //console.log('settings.Remember_me:', settings.result.Remember_me);
            isRemembered = true;
            $('#login-form').hide();
            $('.button-group').show();
            $('.animated-details').show();
            connectToServer(); //
          } else {
            // 未记住登录，显示登录界面
            $('#login-form').show();
            $('.button-group').hide();
            $('.animated-details').hide();
          }
        } else {
          console.error('Failed to check "Remember_me":', response.error);
          toastr.error('Failed to check "Remember_me".', 'Error');
          // 显示登录界面
          $('#login-form').show();
          $('.button-group').hide();
          $('.animated-details').hide();
        }
        tempSocket.disconnect(); // 断开临时连接
      },
    );
  });

  // 错误处理（可选）
  tempSocket.on(MSG_TYPE.ERROR, error => {
    console.error('临时连接错误:', error);
    toastr.error('临时连接错误', 'Error');
    $('#login-form').show();
    $('.button-group').hide();
    $('.animated-details').hide();
    tempSocket.disconnect(); // 确保断开
  });
}

/**
 * @description 处理退出登录点击事件 / Handles the logout click event.
 * @function onLogoutClick
 * @returns {void}
 */
function onLogoutClick() {
  disconnectAllSockets(); // 断开所有连接

  // 使用 function_call 命名空间
  const forgetMeSocket = createSocket(
    NAMESPACES.FUNCTION_CALL,
    {
      clientType: 'extension_FUNCTION_CALL', //或者用其他的类型
      clientId: clientId,
      desc: clientDesc,
    },
    false,
  ); // 不自动连接

  // 显示登录界面，隐藏按钮组和设置
  $('#login-form').show();
  $('.button-group').hide();
  $('.animated-details').hide();
  $('#socketio-testBtn').prop('disabled', true);
}

/**
 * @description 添加日志消息到表格 / Adds a log message to the table.
 * @param {string} type - 日志类型 (success, warning, fail, info) / The type of log message (success, warning, fail, info).
 * @param {string} message - 日志消息 / The log message.
 * @param {string} [source] - 消息来源 / The source of the message.
 * @param {string} [requestId] - 请求 ID / The request ID.
 * @param {string} [outputId] - 输出 ID / The output ID.
 */
function addLogMessage(type, message, source, requestId, outputId) {
    const now = new Date();
    const timeString = now.toLocaleTimeString();
    const logTableBody = $('#socketio-logTableBody');

    /**
     * @description 截断字符串 / Truncates a string.
     * @param {string} str - 要截断的字符串 / The string to truncate.
     * @param {number} maxLength - 最大长度 / The maximum length.
     * @returns {string} 截断后的字符串 / The truncated string.
     */
    function truncate(str, maxLength) {
        if (str === undefined || str === null) {
            return 'N/A';
        }
        return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
    }

    const maxMessageLength = 40;
    const maxSourceLength = 10;
    const maxRequestIdLength = 8;
    const maxOutputIdLength = 8;

    const truncatedMessage = truncate(message, maxMessageLength);
    const truncatedSource = truncate(source, maxSourceLength);
    const truncatedRequestId = truncate(requestId, maxRequestIdLength);
    const truncatedOutputId = truncate(outputId, maxOutputIdLength);

    const timeCell = $('<td/>').text(timeString).addClass('log-time').attr('title', timeString);
    const typeCell = $('<td/>').text(type).addClass('log-type').attr('title', type);
    const messageCell = $('<td/>').text(truncatedMessage).addClass('log-message').attr('title', message);
    const sourceCell = $('<td/>').text(truncatedSource).addClass('log-source').attr('title', source);
    const requestIdCell = $('<td/>').text(truncatedRequestId).addClass('log-request-id').attr('title', requestId);
    const outputIdCell = $('<td/>').text(truncatedOutputId).addClass('log-output-id').attr('title', outputId);

    const row = $('<tr/>').addClass(type);
    row.append(timeCell, typeCell, messageCell, sourceCell, requestIdCell, outputIdCell);

    logTableBody.append(row);
    logCounter++;
    filterLog();
}

/**
 * @description 根据选择的类型过滤日志 / Filters log messages based on the selected type.
 * @function filterLog
 * @returns {void}
 */
function filterLog() {
    const selectedFilter = $('#socketio-logFilter').val();

    $('#socketio-logTableBody tr').each(function () {
        const row = $(this);
        let showRow = false;

        if (selectedFilter === 'all') {
            showRow = true;
        } else if (selectedFilter.startsWith('source-')) {
            const source = selectedFilter.substring('source-'.length);
            showRow = row.find('.log-source').text() === source;
        } else {
            showRow = row.hasClass(selectedFilter);
        }

        row.toggle(showRow);
    });
}

/**
 * @description 更新按钮状态 / Updates the status of the connect and disconnect buttons.
 * @function updateButtonState
 * @param {boolean} isConnected - 是否已连接 / Whether connected.
 * @returns {void}
 */
function updateButtonState(isConnected) {
    $('#socketio-logoutBtn').prop('disabled', !isConnected);
}

/**
 * @description 更新客户端列表 / Updates the client list.
 * @function updateClientList
 * @param {Array} [clients] - 客户端列表 / List of clients.
 * @returns {void}
 */
function updateClientList(clients) {
  const clientListSelect = $('#socketio-clientList');
  clientListSelect.empty();
  clientListSelect.append($('<option>', { value: '', text: '-- Select Client --' }));

  if (!clientsSocket) {
    console.warn('clientsSocket not connected.');
    return;
  }
  // 使用 clients 命名空间
  clientsSocket.emit('getClientList', {}, clients => {
    if (clients) {
      clients.forEach(client => {
        clientListSelect.append(
          $('<option>', {
            value: client.id,
            text: client.id,
          }),
        );
      });
    }
  });
}

/**
 * @description 获取 SillyTavern 实例的端口号 / Gets the port number of the SillyTavern instance.
 * @function getSillyTavernPort
 * @returns {string} SillyTavern 实例的端口号 / The port number of the SillyTavern instance.
 */
function getSillyTavernPort() {
    //SillyTavern的端口储存在这里
    //console.log('Location port:', window.location.port);
    return window.location.port;
    
}

/**
 * @description 生成客户端 ID / Generates a client ID.
 * @function generateClientId
 * @returns {string} 客户端 ID / The client ID.
 */
function generateClientId() {
    const port = getSillyTavernPort();
    return `SillyTavern-${port}`;
}

/**
 * @description 连接到 Socket.IO 服务器 / Connects to the Socket.IO server.
 * @async
 * @function connectToServer
 * @returns {Promise<void>}
 */
async function connectToServer() {
  const serverAddress = $('#socketio-serverAddressInput').val();
  const serverPort = $('#socketio-serverPortInput').val();
  fullServerAddress = `${serverAddress}:${serverPort}`;

  clientId = generateClientId();
  clientDesc = `本客户端是扩展端，运行于 ${getSillyTavernPort()} 端口`;
  
  const sillyTavernMasterKey = null;

  // 获取或生成客户端密钥

  // 临时主连接 (用于认证, 获取初始信息)
  tempMainSocket = createSocket(NAMESPACES.AUTH, {
    clientType: 'extension-noKey',
    clientId: clientId,
    desc: clientDesc,
    key: 'getKey',
  });

  tempMainSocket.connect();

  tempMainSocket.on('connect', async () => {
    tempMainSocket.emit(MSG_TYPE.IDENTIFY_SILLYTAVERN, { clientId }, response => {
      if (response.status === 'ok' && response.key) {
        sillyTavernMasterKey = response.key;
        console.log('sillyTavernMasterKey:', sillyTavernMasterKey);
      } else {
        console.error('Failed to get sillyTavernMasterKey:', response.message);
        toastr.error('Failed to get sillyTavernMasterKey.', 'Error');
        resolve(null);
      }
    });

    console.log('tempMainSocket:', tempMainSocket);
  })

  

  socket = createSocket(NAMESPACES.LLM, {
    clientType: 'extension',
    clientId: clientId,
    desc: clientDesc,
    key: sillyTavernMasterKey,
  });

  socket.connect();

  globalThis.socket = socket; // 暴露给全局 (可选)

  //const key = await getOrCreateClientKey();

  console.log('socket:', socket);

  tempMainSocket.disconnect();

  socket.on('connect', async () => {
    addLogMessage('success', '已连接到服务器', 'client');
    updateButtonState(true);
    $('#socketio-testBtn').prop('disabled', false);
    console.log('Socket.IO: Connected');
    toastr.success('Socket.IO: 已连接', 'Socket.IO');

    // 连接成功后，发送主密钥 (如果存在)
    //sendMasterKey();

    setupLlmSocketListeners();

    // 创建其他命名空间的连接
    createNamespaceConnections();

    // 加载设置 (在主连接建立后)
    loadSettings();

    // 刷新房间和客户端列表
    refreshRoomList();
    updateClientList();
  });

  // setupSocketListeners(); // 不需要了，在各个命名空间的连接中设置监听器

  // 其他事件监听 (可选, 如果需要在默认命名空间监听其他事件)
  socket.on('message', data => {
    /* ... */
    if (data.data === 'Yes,connection is fine.') {
      toastr.success('连接活跃!', '测试连接');
    }
  });
}

// 在主连接建立后创建其他命名空间的连接
function createNamespaceConnections() {
  // AUTH 命名空间
  authSocket = createSocket(NAMESPACES.AUTH, {
    clientType: 'extension_auth', // 可以使用不同的 clientType
    clientId: clientId,
    desc: clientDesc,
    key: socket.auth.key, // 使用主连接的密钥
  });
  setupLlmSocketListeners(); // 设置 LLM 相关的监听器

  // Function Call 命名空间
  functionCallSocket = createSocket(NAMESPACES.FUNCTION_CALL, {
    clientType: 'extension_function_call',
    clientId: clientId,
    desc: clientDesc,
    key: socket.auth.key,
  });
  setupFunctionCallSocketListeners();

  // Rooms 命名空间
  roomsSocket = createSocket(NAMESPACES.ROOMS, {
    clientType: 'extension_rooms',
    clientId: clientId,
    desc: clientDesc,
    key: socket.auth.key,
  });
  setupRoomsSocketListeners();

  // Clients 命名空间
  clientsSocket = createSocket(NAMESPACES.CLIENTS, {
    clientType: 'extension_clients',
    clientId: clientId,
    desc: clientDesc,
    key: socket.auth.key,
  });
  setupClientsSocketListeners();

  // 如果需要与 /sillytavern 命名空间交互，创建 sillyTavernSocket
  // sillyTavernSocket = createSocket(NAMESPACES.SILLY_TAVERN, { /* ... */ });
  // setupSillyTavernSocketListeners(); // 设置 SillyTavern 相关的监听器
}

function setupLlmSocketListeners() {
  if (!llmSocket) return;

  llmSocket.on(MSG_TYPE.LLM_REQUEST, handleLlmRequest);
  llmSocket.on(MSG_TYPE.LLM_RESPONSE, data => {
    /* ... */
    addLogMessage('info', `Received LLM response: ${data.message}`, 'server', data.requestId);
    console.log('Received LLM response:', data);
  });
}

function setupAuthSocketListeners() {
  if (!llmSocket) return;

  socket.on(MSG_TYPE.LLM_REQUEST, handleLlmRequest);
  socket.on(MSG_TYPE.LLM_RESPONSE, data => {
    /* ... */
    addLogMessage('info', `Received LLM response: ${data.message}`, 'from:', data.requestId);
    console.log('Received LLM response:', data);
  });
}

function setupFunctionCallSocketListeners() {
  if (!functionCallSocket) return;

  functionCallSocket.on(MSG_TYPE.FUNCTION_CALL, (data, callback) => {
    if (data.target === clientId) {
      handleFunctionCallFromClient(data, callback); // 确保定义了 handleFunctionCallFromClient
    }
  });
}

function setupRoomsSocketListeners() {
  if (!roomsSocket) return;

  roomsSocket.on(MSG_TYPE.GET_ROOMS, (data, callback) => {
    if (clientId !== sillyTavernSocketId) {
      if (callback) callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    try {
      const rooms = Rooms.getAllRooms();
      if (callback) callback(rooms);
    } catch (error) {
      if (callback) callback({ status: 'error', message: error.message });
    }
  });

  // 其他房间相关的事件监听...
  // 为 "Details" 按钮添加点击事件
  roomsSocket.on('getClientsInRoom', (roomName, callback) => {
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
}

function setupClientsSocketListeners() {
  if (!clientsSocket) return;

  // clientsSocket.on(...) //添加客户端相关的监听器
  clientsSocket.on(MSG_TYPE.GENERATE_CLIENT_KEY, async (data, callback) => {
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

  clientsSocket.on(MSG_TYPE.REMOVE_CLIENT_KEY, (data, callback) => {
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

  clientsSocket.on('getClientList', (data, callback) => {
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
}

// function setupSillyTavernSocketListeners() { // 如果需要
//     if (!sillyTavernSocket) return;
//     // sillyTavernSocket.on(...) // 添加与 SillyTavern 相关的监听器
// }

function onDisconnectClick() {
  // if (socket) { // 改为断开所有连接
  //     socket.disconnect();
  // }
  disconnectAllSockets();
}

/**
 * @description 获取或生成客户端密钥 / Gets or generates a client key.
 * @async
 * @function getOrCreateClientKey
 * @returns {Promise<string>} 客户端密钥 / The client key.
 */
async function getOrCreateClientKey() {
  return new Promise(resolve => {
    // 使用 clients 命名空间
    const keySocket = createSocket(
      NAMESPACES.CLIENTS,{
        clientType: 'extension',
        clientId: clientId,
        key: socket.auth.key,
        desc: clientDesc,
      },
      false,
    );

    keySocket.connect(); // 手动连接
    //console.log('keySocket auth', keySocket);
    keySocket.emit(MSG_TYPE.GET_CLIENT_KEY, { clientId }, response => {
      if (response.status === 'ok' && response.key) {
        resolve(response.key);
      } else {
        keySocket.emit(MSG_TYPE.GENERATE_CLIENT_KEY, { clientId }, response => {
          if (response.status === 'ok' && response.key) {
            resolve(response.key);
          } else {
            console.error('Failed to generate client key:', response.message);
            toastr.error('Failed to generate client key.', 'Error');
            resolve(null);
          }
        });
      }
      console.log('response.key', response);
      keySocket.disconnect(); // 获取或生成密钥后断开连接
    });
  });
}

/**
 * @description 发送主密钥 (如果存在) / Sends the master key (if it exists).
 * @function sendMasterKey
 * @returns {void}
 */
function sendMasterKey() {
  if (serverSettings.sillyTavernMasterKey) {
    // 使用 auth 命名空间
    const masterKeySocket = createSocket(
      NAMESPACES.AUTH,
      {
        clientType: 'extension_master_key',
        clientId: clientId,
        desc: clientDesc,
        key: socket.auth.key, // 使用主连接的密钥
      },
      false,
    );
    masterKeySocket.connect();

    masterKeySocket.emit(MSG_TYPE.IDENTIFY_SILLYTAVERN, { key: serverSettings.sillyTavernMasterKey }, response => {
      masterKeySocket.disconnect();
    });
  }
}

/**
 * @description 测试与 Socket.IO 服务器的连接 / Tests the connection with the Socket.IO server.
 * @function onTestClick
 * @returns {void}
 */
function onTestClick() {
    if (socket && socket.connected) {
        import('./lib/non_stream.js').then(module => {
            module.sendNonStreamMessage(socket, 'Connection active?');
        });
    }
}

/**
 * @description 处理接收到的流式 Token / Handles incoming stream tokens.
 * @function handleStreamToken
 * @param {object} data - 接收到的数据 / Received data.
 * @returns {void}
 */
function handleStreamToken(data) {
    const latestRequestId = llmRequestQueue.at(-1).requestId;
    messageForwarder.handleStreamToken(data, messageForwarder.getMessageType(), latestRequestId);
}

/**
 * @description 更新转发选项的可见性 / Updates the visibility of forwarding options.
 * @function updateForwardingOptionsVisibility
 * @returns {void}
 */
function updateForwardingOptionsVisibility() {
    const defaultForwardingChecked = $('#socketio-defaultForwarding').is(':checked');
    $('#message-handling-options').toggle(true);

    if (defaultForwardingChecked) {
        $('#socketio-enableStream').parent().hide();
        $('#socketio-enableNonStream').parent().hide();
    } else {
        $('#socketio-enableStream').parent().show();
        $('#socketio-enableNonStream').parent().show();
    }
    if (!defaultForwardingChecked) {
        checkAndHandleMutex();
    }
}

/**
 * @description 检查并处理互斥情况（流式转发和非流式转发不能同时启用）/ Checks and handles mutex cases (streaming and non-streaming forwarding cannot be enabled at the same time).
 * @function checkAndHandleMutex
 * @returns {boolean} 如果存在互斥情况则返回 true，否则返回 false / Returns true if a mutex case exists, false otherwise.
 */
function checkAndHandleMutex() {
    if ($('#socketio-enableStream').is(':checked') && $('#socketio-enableNonStream').is(':checked')) {
        console.warn('流式转发和非流式转发不能同时启用。已禁用所有转发。');
        toastr.warning('流式转发和非流式转发不能同时启用。已禁用所有转发。', '配置错误');
        messageForwarder.disableStreamForwarding();
        messageForwarder.disableNonStreamForwarding();
        $('#socketio-enableStream').prop('checked', false);
        $('#socketio-enableNonStream').prop('checked', false);
        return true;
    }
    return false;
}

/**
 * @description 测试函数，在扩展加载 5 秒后触发文本生成 / Test function to trigger text generation after 5 seconds.
 * @async
 * @function testGenerate
 * @returns {Promise<void>}
 */
async function testGenerate() {
    console.log('测试开始：5秒后将触发文本生成...');

    const generateConfig = {
        user_input: '你好',
        stream: false,
    };

    setTimeout(() => {
        iframeGenerate(generateConfig);
    }, 5000);
}

// 新增：处理请求队列
async function processRequest() {
  if (isProcessingRequest) {
    return; // 如果有请求正在处理，则直接返回 / If a request is already being processed, return directly
  }

  if (llmRequestQueue.length > 0) {
    isProcessingRequest = true;
    const request = llmRequestQueue.shift(); // 从队列中取出第一个请求 / Take the first request from the queue

    try {
      // 调用 iframeGenerate 生成文本
      await iframeGenerate(request.generateConfig);
      
      //生成的文本会通过事件监听器自动进行处理，无需在此进行处理
    } catch (error) {
      console.error('生成文本时出错:', error);
      addLogMessage('fail', `生成文本时出错: ${error}`, 'client', request.requestId);

      if (llmSocket && llmSocket.connected) {
        // 使用 llmSocket 发送错误消息
        llmSocket.emit(MSG_TYPE.ERROR, {
          type: MSG_TYPE.ERROR,
          message: '生成文本时出错',
          error: error.message,
          requestId: request.requestId,
        });
      }
    } finally {
      isProcessingRequest = false;
      processRequest(); // 递归调用，处理下一个请求
    }
  } else if (functionCallQueue.length > 0) {
    isProcessingRequest = true;
    const { data, callback } = functionCallQueue.shift();
    // 使用 functionCallSocket
    functionCallSocket.emit(MSG_TYPE.FUNCTION_CALL, data, response => {
      callback(response);
      isProcessingRequest = false;
      processRequest();
    });
  }
}

/**
 * @description 处理 LLM 请求 / Handles an LLM request.
 * @async
 * @function handleLlmRequest
 * @param {object} data - 请求数据 / Request data.
 * @param {string} data.message - 要生成文本的消息 / The message to generate text from.
 * @param {string} data.requestId - 请求 ID / The request ID.
 * @param {string} [data.outputId] - 输出 ID / The output ID.
 * @returns {Promise<void>}
 */
async function handleLlmRequest(data) {
  addLogMessage('info', `Received LLM request: ${data.message}`, 'server', data.requestId);
  toastr.info(`Received LLM request: ${data.message}`, 'LLM Request');
  console.log('Received LLM request:', data);

  const generateConfig = {
    user_input: data.message,
    stream: globalThis.isLLMStreamOutput,
  };

  // 将请求添加到队列 / Add the request to the queue
  llmRequestQueue.push({ generateConfig, requestId: data.requestId, outputId: data.outputId });
  processRequest(); // 尝试处理请求 / Try to process the request
}

eventSource.on('js_generation_ended', generatedText => {
  console.log('生成结果:', generatedText);
});

eventSource.on('generation_ended', messageId => {
  console.log(`SillyTavern 收到消息，ID: ${messageId}`);
  const { chat } = SillyTavern.getContext();
  const message = chat[messageId];
  console.log('消息内容:', message.mes);
});

/**
 * @description 刷新房间列表 / Refreshes the room list.
 * @async
 * @function refreshRoomList
 * @returns {Promise<void>}
 */
async function refreshRoomList() {
  if (!roomsSocket) {
    console.warn('roomsSocket not connected.');
    return;
  }

  try {
    // const rooms = await getRooms(roomsSocket); // 使用 roomsSocket
    roomsSocket.emit(MSG_TYPE.GET_ROOMS, {}, rooms => {
      displayRoomList(rooms);
    });
  } catch (error) {
    console.error('Failed to get rooms:', error);
  }
}

/**
 * @description 显示房间列表 / Displays the room list.
 * @async
 * @function displayRoomList
 * @param {string[]} rooms - 房间名称数组 / An array of room names.
 * @returns {Promise<void>}
 */
async function displayRoomList(rooms) {
  const roomList = $('#socketio-roomList');
  roomList.empty(); // 清空现有列表 / Clear existing list

  if (rooms.length === 0) {
    roomList.append('<tr><td colspan="3">No rooms yet.</td></tr>');
    return;
  }

  // 获取每个房间的客户端数量和详细信息 / Get client count and details for each room
  for (const roomName of rooms) {
    const clients = await getClientsInRoom(roomName);
    const clientCount = clients.length;

    const row = $(`
            <tr>
                <td>${roomName}</td>
                <td>${clientCount}</td>
                <td>
                    <button class="menu_button details-btn" data-room="${roomName}">Details</button>
                    <button class="menu_button leave-btn" data-room="${roomName}">Leave</button>
                </td>
            </tr>
        `);
    roomList.append(row);
  }

  // 为 "Details" 按钮添加点击事件 / Add click event for "Details" buttons
  $('.details-btn')
    .off('click')
    .on('click', function () {
      const roomName = $(this).data('room');
      displayRoomDetails(roomName);
    });

  // 为 "Leave" 按钮添加点击事件 / Add click event for "Leave" buttons
  $('.leave-btn')
    .off('click')
    .on('click', function () {
      const roomName = $(this).data('room');
      removeClientFromRoom(socket, clientId, roomName) // 移除自己 / Remove self
        .then(success => {
          if (success) {
            refreshRoomList(); // 刷新房间列表 / Refresh room list
          }
        });
    });

  updateDeleteRoomSelect(rooms);

  // 自动加入第一个房间 / Auto-join the first room
  if (rooms.length > 0) {
    addClientToRoom(socket, clientId, rooms[0]).then(success => {
      if (!success) {
        console.warn('Failed to auto-join the first room.');
      }
    });
  }
}

/**
 * @description 获取房间内的客户端列表 / Gets the list of clients in a room.
 * @function getClientsInRoom
 * @param {string} roomName - 房间名称 / The name of the room.
 * @returns {Promise<Array>} 房间内的客户端列表 / The list of clients in the room.
 */
function getClientsInRoom(roomName) {
  return new Promise(resolve => {
    socket.emit('getClientsInRoom', roomName, clients => {
      resolve(clients);
    });
  });
}

/**
 * @description 更新删除房间的下拉列表 / Updates the dropdown list for deleting rooms.
 * @function updateDeleteRoomSelect
 * @param {string[]} rooms - 房间名称数组 / An array of room names.
 * @returns {void}
 */
function updateDeleteRoomSelect(rooms) {
  const select = $('#socketio-deleteRoomSelect');
  select.empty(); // 清空现有选项
  select.append($('<option>', { value: '', text: '-- Select Room to Delete --' }));
  rooms.forEach(roomName => {
    select.append($('<option>', { value: roomName, text: roomName }));
  });
}

/**
 * @description 显示房间详情 (客户端列表) / Displays the details of a room (client list).
 * @async
 * @function displayRoomDetails
 * @param {string} roomName - 房间名称 / The name of the room.
 * @returns {Promise<void>}
 */
async function displayRoomDetails(roomName) {
    const clients = await getClientsInRoom(roomName);
    const detailsDiv = $('#room-details');
    detailsDiv.empty();

    if (clients.length === 0) {
        detailsDiv.text(`No clients in room ${roomName}.`);
        return;
    }

    const ul = $('<ul>');
    clients.forEach(client => {
        const clientDesc = client.description ? ` ( ${client.description} )` : '';
        ul.append($('<li>').text(`${client.id} ${clientDesc}`));
    });
    detailsDiv.append(ul);
}

// 新增: 生成并显示客户端密钥
async function generateAndDisplayClientKey() {
  const selectedClientId = $('#socketio-clientList').val();
  if (!selectedClientId) {
    toastr.warning('请选择一个客户端', '错误');
    return;
  }
  // 使用 clients 命名空间
  clientsSocket.emit(MSG_TYPE.GENERATE_CLIENT_KEY, { clientId: selectedClientId }, response => {
    if (response.status === 'ok') {
      $('#socketio-clientKeyDisplay').text(response.key).attr('title', response.key);
    } else {
      toastr.error(response.message || 'Failed to generate key.', 'Error');
    }
  });
}

// 新增: 复制客户端密钥
function copyClientKey() {
  const key = $('#socketio-clientKeyDisplay').text();
  if (key) {
    navigator.clipboard
      .writeText(key)
      .then(() => {
        toastr.success('密钥已复制', '成功');
      })
      .catch(err => {
        console.error('Failed to copy key:', err);
        toastr.error('复制密钥失败', '错误');
      });
  }
}

// 新增: 移除客户端密钥
function removeClientKey() {
  const selectedClientId = $('#socketio-clientList').val();
  if (!selectedClientId) {
    toastr.warning('请选择一个客户端', '错误');
    return;
  }

  // 使用 clients 命名空间
  clientsSocket.emit(MSG_TYPE.REMOVE_CLIENT_KEY, { clientId: selectedClientId }, response => {
    if (response.status === 'ok') {
      toastr.success('客户端密钥已移除', '成功');
      $('#socketio-clientKeyDisplay').text(''); // 清空显示
      updateClientList(); //刷新列表
    } else {
      toastr.error(response.message || 'Failed to remove key.', 'Error');
    }
  });
}

async function loadSettings() {
  // 使用 function_call 命名空间
  functionCallSocket.emit(
    MSG_TYPE.FUNCTION_CALL,
    {
      requestId: 'loadSettings',
      target: 'server',
      functionName: 'readJsonFromFile',
      args: [`./settings/${clientId}-settings.json`],
    },
    response => {
      if (response.success) {
        const settings = response.result;
        console.log('Loaded settings:', settings);

        // Fill the UI elements with the loaded settings
        $('#socketio-serverPortInput').val(settings.serverPort || '4000');
        $('#socketio-serverAddressInput').val(settings.serverAddress || 'http://localhost');
        // ... other settings ...
      } else {
        console.error('Failed to load settings:', response.error);
        toastr.error('Failed to load settings.', 'Error');
      }
    },
  );
}

// 新增：保存设置
async function saveSettings() {
  const settings = {
    serverPort: $('#socketio-serverPortInput').val(),
    serverAddress: $('#socketio-serverAddressInput').val(),
    // ... 其他设置 ...
    reconnectAttempts: 10,
    reconnectDelay: 1000,
    timeout: 5000,
    autoConnect: true,
    socketIOPath: '/socket.io',
    queryParameters: {},
    transport: 'websocket',
  };

  // 使用 function_call 命名空间
  functionCallSocket.emit(
    MSG_TYPE.FUNCTION_CALL,
    {
      requestId: 'saveSettings',
      target: 'server',
      functionName: 'saveJsonToFile',
      args: [`./settings/${clientId}-settings.json`, settings],
    },
    response => {
      if (response.success) {
        console.log('Settings saved.');
        toastr.success('Settings saved.', 'Success');
      } else {
        console.error('Failed to save settings:', response.error);
        toastr.error('Failed to save settings.', 'Error');
      }
    },
  );
}

// 当前仅做示例
const extensionFunctions = {
  myFunction1: function (arg1, arg2) {
    console.log('myFunction1 called with:', arg1, arg2);
    return { result: 'Hello from myFunction1' };
  },
  myFunction2: async function (arg1) {
    console.log('myFunction2 called with:', arg1);
    await delay(1000); // 模拟异步操作
    return { result: 'Hello from myFunction2' };
  },
};
// 处理来自服务器的 FUNCTION_CALL 请求，暂未正式使用
function handleFunctionCallFromClient(data, callback) {
  const { requestId, functionName, args } = data;
  const func = extensionFunctions[functionName];

  if (!func) {
    console.warn(`Function "${functionName}" not found in extension.`);
    callback({
      requestId,
      success: false,
      error: { message: `Function "${functionName}" not found.` },
    });
    return;
  }

  Promise.resolve(func(...args)) // 使用 Promise.resolve 包装，以处理同步和异步函数
    .then(result => {
      callback({ requestId, success: true, result });
    })
    .catch(error => {
      console.error(`Error calling function "${functionName}" in extension:`, error);
      callback({
        requestId,
        success: false,
        error: { message: error.message || 'An unknown error occurred.' },
      });
    });
}

jQuery(async () => {
  const settingsHtml = await $.get(`${extensionFolderPath}/index_NewAge.html`);

  //await loadFileToDocument(`${extensionFolderPath}/style.css`, 'css');

  $('#extensions_settings').append(settingsHtml);

  // 手动调用前端助手的所有注册函数
  registerIframeChatMessageHandler();
  registerIframeDisplayedMessageHandler();
  registerIframeEventHandler();
  registerIframeFrontendVersionHandler();
  registerIframeGenerateHandler();
  registerIframeLorebookEntryHandler();
  registerIframeLorebookHandler();
  registerIframeSlashHandler();
  registerIframeTavernRegexHandler();
  registerIframeUtilHandler();
  registerIframeVariableHandler();

  // 监听 message 事件，并调用 handleIframe
  window.addEventListener('message', handleIframe);

  $('#socketio-testBtn').on('click', onTestClick);
  $('#socketio-saveSettingsBtn').on('click', saveSettings);

  $('#socketio-logFilter').on('change', filterLog);

  $('#socketio-refreshRoomsBtn').on('click', refreshRoomList);

  $('#socketio-loginBtn').on('click', onLoginClick);
  $('#socketio-logoutBtn').on('click', onLogoutClick);

  // testGenerate();

  checkRememberMe(); // 检查是否记住登录

  $('#socketio-defaultForwarding').on('change', function () {
    updateForwardingOptionsVisibility();

    if (this.checked) {
      const isStreaming = $('#stream_toggle').is(':checked');
      if (isStreaming) {
        messageForwarder.enableStreamForwarding();
        messageForwarder.disableNonStreamForwarding();
      } else {
        messageForwarder.disableStreamForwarding();
        messageForwarder.enableNonStreamForwarding();
      }
    }
  });

  $('#stream_toggle').on('change', function () {
    globalThis.isLLMStreamOutput = this.checked;
    console.log('stream_toggle:', isLLMStreamOutput);

    if ($('#socketio-defaultForwarding').is(':checked')) {
      if (this.checked) {
        messageForwarder.enableStreamForwarding();
        messageForwarder.disableNonStreamForwarding();
      } else {
        messageForwarder.disableStreamForwarding();
        messageForwarder.enableNonStreamForwarding();
      }
    }
  });

  $('#socketio-enableStream').on('change', function () {
    if (!$('#socketio-defaultForwarding').is(':checked') && checkAndHandleMutex()) {
      return;
    }

    if (this.checked) {
      messageForwarder.enableStreamForwarding();
    } else {
      messageForwarder.disableStreamForwarding();
    }
  });

  $('#socketio-enableNonStream').on('change', function () {
    if (!$('#socketio-defaultForwarding').is(':checked') && checkAndHandleMutex()) {
      return;
    }

    if (this.checked) {
      messageForwarder.enableNonStreamForwarding();
    } else {
      messageForwarder.disableNonStreamForwarding();
    }
  });

  globalThis.isLLMStreamOutput = $('#stream_toggle').is(':checked');
  console.log('isStreamToggle:', isLLMStreamOutput);
  if (isLLMStreamOutput) {
    messageForwarder.enableStreamForwarding();
    messageForwarder.disableNonStreamForwarding();
  } else {
    messageForwarder.disableStreamForwarding();
    messageForwarder.enableNonStreamForwarding();
  }

  updateForwardingOptionsVisibility();

  let latestRequestId = null;

  eventSource.on(event_types.STREAM_TOKEN_RECEIVED, data => {
    if (messageForwarder.isStreamForwardingEnabled) {
      latestRequestId = llmRequestQueue.at(-1).requestId;
      messageForwarder.handleStreamToken(data, messageForwarder.getMessageType(), latestRequestId); 
    } else if (messageForwarder.isNonStreamForwardingEnabled) {
      messageForwarder.accumulateStreamData(data, latestRequestId);
    }
  });

  eventSource.on(event_types.MESSAGE_RECEIVED, messageId => {
    if (!globalThis.isLLMStreamOutput) {
      latestRequestId = llmRequestQueue.at(-1).requestId;
      messageForwarder.handleNonStreamMessage(
        messageId,
        messageForwarder.getMessageType(),
        latestRequestId,
      ); 
    }
  });

  let generationStartedHandled = false;
  
  eventSource.on(event_types.GENERATION_STARTED, () => {
    if (!generationStartedHandled) {
      messageForwarder.setNewOutputId();
      messageForwarder.resetPreviousLLMData();
      generationStartedHandled = true;
    }
  });

  eventSource.on(event_types.GENERATION_ENDED, () => {
    messageForwarder.resetOutputId();
    messageForwarder.resetPreviousLLMData();
    generationStartedHandled = false;
  });

  eventSource.on(event_types.GENERATION_STOPPED, () => {
    messageForwarder.resetOutputId();
    messageForwarder.resetPreviousLLMData();
    generationStartedHandled = false;
  });

  eventSource.on('js_generation_ended', generatedText => {
    console.log('生成结果:', generatedText);
  });

  // 新增：客户端密钥管理事件
  $('#socketio-generateKeyBtn').on('click', generateAndDisplayClientKey);
  $('#socketio-copyKeyBtn').on('click', copyClientKey);
  $('#socketio-removeKeyBtn').on('click', removeClientKey);

  // 初始隐藏一些元素
  $('.button-group').hide();
  $('.animated-details').hide();

  // 设置扩展识别名称和端口号 (只读)
  $('#socketio-extensionName').val(generateClientId()).attr('readonly', true);
  $('#socketio-localPortInput').val(getSillyTavernPort()).attr('readonly', true);

  
});
