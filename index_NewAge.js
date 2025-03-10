//index_NewAge.js

import { MSG_TYPE, STREAM_EVENTS, NAMESPACES } from './lib/constants.js';
import { io } from './lib/Socket.io/socket.io.js';
import { uuidv4 } from './lib/uuid/uuid.js';
import { eventSource, event_types } from '../../../../script.js';
import { loadFileToDocument, delay } from '../../../../scripts/utils.js';
import {
  chat,
  messageFormatting,
  reloadCurrentChat,
  saveChatConditional,
  substituteParamsExtended,
} from '../../../../../../script.js';
import * as messageForwarder from './dist/NewAge/message_forwarder.js';
import { getChatMessages, setChatMessage } from './dist/NewAge/chat.js';

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
import { addClientToRoom, removeClientFromRoom } from './dist/NewAge/Rooms.js';
//import { clientKeys } from './server/dist/Keys.js';

const extensionName = 'SillyTavern-NewAge';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// 各种socket
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

// 请求队列
const llmRequestQueue = [];
const functionCallQueue = [];
let isProcessingRequest = false; // 标志：是否有请求正在处理中
let isExpectingLLMResponse = false; // 全局标志，指示是否正在等待 LLM 响应
let previousLLMResponse = null; // 存储上一个 LLM 响应的文本
let previousRequest = null; //新增：存储上一个请求
let isNewChat = true; // 标志：是否为新的聊天

// socket.handshake.auth相关
let isRemembered = false;
let clientId = generateClientId(); // 声明 clientId
let clientDesc = '这是一个SillyTaven扩展'; //声明clientDesc
let fullServerAddress = 'http://localhost:4000'; //声明 fullServerAddress

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const { createSocket: newSocket, cleanupAllSockets } = manageSockets(createSocket);

/**
 * @description 创建并配置 Socket.IO 连接
 * @param {string} namespace - 命名空间
 * @param {object} authData - 认证数据
 * @param {boolean} [autoConnect=false] - 是否自动连接
 * @returns {initSocket} - Socket.IO 连接实例
 */
function createSocket(namespace, authData, autoConnect = false, reconnection = false, reconnectionAttempts = 3) {
  const initSocket = io(fullServerAddress + namespace, {
    auth: authData,
    clientId: clientId,
    autoConnect: autoConnect,
    reconnection: reconnection,
    reconnectionAttempts: reconnectionAttempts,
  });

  // 通用错误处理
  initSocket.on('connect_error', error => {
    addLogMessage('fail', `[${namespace}] 连接错误: ${error}`, 'clientType:');
    console.error(`Socket.IO [${namespace}],clientType:${initSocket.auth.clientType}: Connection error`, error);
    console.log(
      `Socket.IO [${namespace}], clientType:${initSocket.auth.clientType}: Disconnected. Reason: ${reason}, ID: ${initSocket.id}, Last Received: ${lastReceived}, Last Sent: ${lastSent}`,
    );
    //toastr.error(`[${namespace}] 连接错误: ${error}`, 'Socket.IO');
  });

  initSocket.on('disconnect', reason => {
    const lastReceived = initSocket.lastReceived ? new Date(initSocket.lastReceived).toISOString() : 'N/A';
    const lastSent = initSocket.lastSent ? new Date(initSocket.lastSent).toISOString() : 'N/A';

    addLogMessage(
      'warning',
      `[${namespace}] Disconnected. Reason: ${reason}, ID: ${initSocket.id}, Last Received: ${lastReceived}, Last Sent: ${lastSent}`,
      'client',
    );
    console.log(
      `Socket.IO [${namespace}], clientType:${initSocket.auth.clientType}: Disconnected. Reason: ${reason}, ID: ${initSocket.id}, Last Received: ${lastReceived}, Last Sent: ${lastSent}`,
    );
    // toastr.warning(`[${namespace}] Disconnected. Reason: ${reason}`, 'Socket.IO');
  });

  initSocket.on('error', error => {
    console.error('Socket.IO Client Error:', error);
    addLogMessage('fail', `Socket.IO Client Error:: ${error}`, 'clientType:');
    // 可以根据错误类型采取不同的操作
    if (error.message === 'parse error') {
      // 处理 parse error
      console.error('Parse error detected on the client side. Check for data format issues.');
    }
    if (error.message === 'xhr poll error') {
      // 处理 xhr poll error
      console.error('xhr poll error. Please check your network status');
    }
  });
  return initSocket;
}

function manageSockets(socketCreationFunction) {
  const activeSockets = new Set();
  const pendingRemoval = new Map(); // 用于存储待移除的 socket

  const wrappedCreateSocket = (...args) => {
    const socket = socketCreationFunction(...args);
    activeSockets.add(socket);
    let reconnectionAttempts = socket.io.opts.reconnectionAttempts;
    let attempts = 0;

    socket.on('disconnect', reason => {
      //将所有断连的socket都加入到待删除的Map
      //因为如果是客户端主动断连，那么在removeSocket()里已经清理了
      //如果是自动断连，也会在重试失败后调用removeSocket()
      //所以这里无论如何都把断连的socket加入到pendingRemoval，不会出现重复清理的问题
      scheduleSocketRemoval(socket);

      if (!socket.io.opts.reconnection) {
        //removeSocket(socket); //直接清理，交给scheduleSocketRemoval
      } else {
        attempts = 0; // Reset attempts counter on disconnect
      }
    });

    socket.on('reconnect_attempt', () => {
      attempts++;
      if (attempts > reconnectionAttempts) {
        console.log(`Socket ${socket.id || socket.nsp} exceeded reconnection attempts. Cleaning up.`);
        removeSocket(socket); //这里不需要schedule，因为是主动清理
      }
    });

    socket.on('connect', () => {
      activeSockets.add(socket); //在connect事件时重新加入activeSockets
      attempts = 0;
    });

    return socket;
  };

  const removeSocket = async socket => {
    if (activeSockets.has(socket)) {
      try {
        socket.emit(MSG_TYPE.CLIENT_DISCONNETED, {
          clientId: socket.auth.clientId,
          clientType: socket.auth.clientType,
          reason: 'client_side_cleanup',
        });
      } catch (error) {
        console.error('Error emitting client disconnect:', error);
      }

      await sleep(3000); //稍微等待
      disconnectSocket(socket); //先断连
      socket.removeAllListeners();
      activeSockets.delete(socket);
      console.log('Socket marked for removal:', socket.id || socket.nsp);
    }
  };

  const scheduleSocketRemoval = socket => {
    pendingRemoval.set(socket, Date.now());
    // 清理函数, 过期清理
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [s, timestamp] of pendingRemoval) {
        if (now - timestamp > 500) {
          // 500ms 后清理
          if (activeSockets.has(s)) {
            removeSocket(s);
          }
          pendingRemoval.delete(s);
          console.log('Delayed socket removal completed', s.id || s.nsp);
        }
      }
      // 如果 pendingRemoval 为空，清除 interval
      if (pendingRemoval.size === 0) {
        clearInterval(cleanupInterval);
      }
    }, 200); // 检查间隔, 每200ms检查
  };

  const cleanupAllSockets = () => {
    //在清理所有socket前，先清理所有待移除的socket
    for (const socket of pendingRemoval.keys()) {
      removeSocket(socket);
    }
    pendingRemoval.clear();

    activeSockets.forEach(socket => {
      removeSocket(socket);
    });
  };

  return {
    createSocket: wrappedCreateSocket,
    cleanupAllSockets: cleanupAllSockets,
  };
}

const sockets = new Map();

function createNamedSocket(namespace, authData, autoConnect = false, reconnection = false, reconnectionAttempts = 3) {
  const clientType = authData.clientType || 'defaultClientType'; // 获取clientType，如果没有则使用默认值
  const shortUuid = uuidv4(8); // 生成一个较短的UUID
  const variableName = `${clientType}_${shortUuid}`;

  const socket = newSocket(namespace, authData, autoConnect, reconnection, reconnectionAttempts);
  sockets.set(variableName, socket); // 或者： sockets[variableName] = socket;

  console.log(`Created socket with variable name: ${variableName}`);

  return socket; // 或者返回 { name: variableName, socket } 更方便访问
}

function disconnectSocket(socket) {
  console.log(`${socket.auth.clientType} is disconnect.`);
  socket.disconnect(true);
}

/**
 * @description 断开所有 Socket.IO 连接
 */
function disconnectAllSockets() {
  if (socket) {
    disconnectSocket(socket);
    socket = null;
  }
  if (llmSocket) {
    disconnectSocket(llmSocket);
    llmSocket = null;
  }
  if (functionCallSocket) {
    disconnectSocket(functionCallSocket);
    functionCallSocket = null;
  }
  if (roomsSocket) {
    disconnectSocket(roomsSocket);
    roomsSocket = null;
  }
  if (clientsSocket) {
    disconnectSocket(clientsSocket);
    clientsSocket = null;
  }
  // if (sillyTavernSocket) { // 如果有
  //     sillyTavernSocket.disconnect();
  //     sillyTavernSocket = null;
  // }
  updateButtonState(false); // 更新按钮状态
  $('#ST-NewAge-socketio-testBtn').prop('disabled', true); // 禁用测试按钮
}

/**
 * @description 处理登录点击事件 / Handles the login click event.
 * @async
 * @function onLoginClick
 * @returns {Promise<void>}
 */
/*(直到能修好bug之前，都不再执行登录操作)
async function onLoginClick() {
  const password = $('#ST-NewAge-socketio-password').val();
  const rememberMe = $('#ST-NewAge-socketio-rememberMe').is(':checked');

  // 使用默认命名空间进行登录
  const loginSocket = createNamedSocket(
    NAMESPACES.AUTH,
    {
      clientType: 'extension_loginSocket',
      clientId: clientId,
      desc: clientDesc,
      key: 'getKey', // 初始连接时发送 'getKey'
      password: password,
      rememberMe: rememberMe,
    },
    false, // 设置为 false，手动控制连接
  );

  // 手动连接 (在监听 connect 事件之后)
  loginSocket.connect();

  console.log('loginSocket connecting to server');

  loginSocket.on(MSG_TYPE.CLIENT_KEY_ASSIGNED, data => {
    if (data.success) {
      $('#ST-NewAge-login-form').hide();
      $('#ST-NewAge-login-message').text('').removeClass('error');
      $('.ST-NewAge-button-group').show();
      $('.ST-NewAge-animated-details').show();
      console.log('login success', data.key);
    } else {
      console.error("login fail,reason:",data.message);
    }
    console.log('data', data);
  });

  // 监听 connect 事件
  
}
*/

/**
 * @description 手动登录点击事件 / Handles the login click event.
 */
async function connectToServerByHand(){
  const serverAddress = $('#ST-NewAge-socketio-connect-serverAddressInput').val();
  const serverPort = $('#ST-NewAge-socketio-connect-serverPortInput').val();
  fullServerAddress = `${serverAddress}:${serverPort}`;

  checkRememberMe();
}

/**
 * @description 检查是否记住登录 / Checks if login is remembered.
 * @async
 * @function checkRememberMe
 * @returns {Promise<void>}
 */
async function checkRememberMe() {
  // 使用 function_call 命名空间
  const tempSocket = createNamedSocket(
    NAMESPACES.FUNCTION_CALL,
    {
      clientType: 'extension_checkRememberMe',
      clientId: clientId,
      desc: clientDesc,
    },
    false,
    true,
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
            $('#ST-NewAge-login-form').hide();
            $('.ST-NewAge-button-group').show();
            $('.ST-NewAge-animated-details').show();
            connectToServer(); //
          } else {
            // 未记住登录，显示登录界面(暂时强制显示，因为登陆界面被暂时放弃)
            /*
            $('#login-form').show();
            $('.button-group').hide();
            $('.animated-details').hide();
            */
            isRemembered = true;
            //$('#ST-NewAge-login-form').hide();
            $('#ST-NewAge-socketio-connect').hide();
            $('.ST-NewAge-button-group').show();
            $('.ST-NewAge-animated-details').show();
            connectToServer(); //强制连接
          }
        } else {
          console.error('Failed to check "Remember_me":', response.error);
          toastr.error('Failed to check "Remember_me".', 'Error');
          // 显示登录界面
          //$('#ST-NewAge-login-form').show();
          $('#ST-NewAge-socketio-connect').show();
          $('.ST-NewAge-button-group').hide();
          $('.ST-NewAge-animated-details').hide();
        }
        //tempSocket.disconnect(); // 断开临时连接
        disconnectSocket(tempSocket);
      },
    );
  });

  // 错误处理（可选）
  tempSocket.on(MSG_TYPE.ERROR, error => {
    console.error('临时连接错误:', error);
    toastr.error('临时连接错误', 'Error');
    $('#ST-NewAge-login-form').show();
    $('.ST-NewAge-button-group').hide();
    $('.ST-NewAge-animated-details').hide();
    //tempSocket.disconnect(); // 确保断开
    disconnectSocket(tempSocket);
  });
}

async function loadNetworkSafeSetting() {
  const tempSocket = createNamedSocket(
    NAMESPACES.FUNCTION_CALL,
    {
      clientType: 'extension_loadNetworkSafe',
      clientId: clientId,
      desc: clientDesc,
    },
    false,
  );

  tempSocket.connect();

  tempSocket.on('connect', () => {
    console.log('Checking network safe setting...');
    tempSocket.emit(
      MSG_TYPE.FUNCTION_CALL,
      {
        requestId: 'loadNetworkSafeSetting',
        target: 'server',
        functionName: 'readJsonFromFile',
        args: [`./settings/server_settings.json`], // 读取 server_settings.json
      },
      response => {
        if (response.success) {
          const settings = response.result;
          console.log('Server settings loaded:', settings);
          if (settings.networkSafe !== undefined) {
            $('#ST-NewAge-socketio-networkSafeMode').prop('checked', settings.networkSafe);
          } else {
            // 如果设置不存在，则设置默认值 (例如，true)
            $('#ST-NewAge-socketio-networkSafeMode').prop('checked', true);
            console.warn('networkSafe setting not found in server_settings.json. Using default value (true).');
          }
        } else {
          console.error('Failed to load network safe setting:', response.error);
          toastr.error('Failed to load network safe setting.', 'Error');
          // 设置一个默认值 (例如，true)
          $('#ST-NewAge-socketio-networkSafeMode').prop('checked', true);
        }
        disconnectSocket(tempSocket);
      },
    );
  });

  tempSocket.on('error', error => {
    console.error('Error loading network safe setting:', error);
    toastr.error('Error loading network safe setting.', 'Error');
    $('#ST-NewAge-socketio-networkSafeMode').prop('checked', true); // 出错时也设置一个默认值
    disconnectSocket(tempSocket);
  });
  tempSocket.on('disconnect', reason => {
    console.log('tempSocket for loadNetworkSafeSetting disconnected,', reason);
  });
}

/**
 * @description 处理退出登录点击事件 / Handles the logout click event.
 * @function onLogoutClick
 * @returns {void}
 */
function onLogoutClick() {
  cleanupAllSockets(); // 断开所有连接

  // 使用 function_call 命名空间
  const forgetMeSocket = createNamedSocket(
    NAMESPACES.FUNCTION_CALL,
    {
      clientType: 'extension_forgetMeSocket', //或者用其他的类型
      clientId: clientId,
      desc: clientDesc,
    },
    false,
  ); // 不自动连接

  // 显示登录界面，隐藏按钮组和设置
  $('#ST-NewAge-login-form').show();
  $('.ST-NewAge-button-group').hide();
  $('.ST-NewAge-animated-details').hide();
  $('#ST-NewAge-socketio-testBtn').prop('disabled', true);
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
  const logTableBody = $('#ST-NewAge-socketio-logTableBody');

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
  const selectedFilter = $('#ST-NewAge-socketio-logFilter').val();

  $('#ST-NewAge-socketio-logTableBody tr').each(function () {
    const row = $(this);
    let showRow = false;

    if (selectedFilter === 'all') {
      showRow = true;
    } else if (selectedFilter.startsWith('source-')) {
      const source = selectedFilter.substring('source-'.length);
      showRow = row.find('.ST-NewAge-log-source').text() === source;
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
  $('#ST-NewAge-socketio-logoutBtn').prop('disabled', !isConnected);
}

/**
 * @description 更新客户端列表 / Updates the client list.
 * @function updateClientList
 * @param {Array} [clients] - 客户端列表 / List of clients.
 * @returns {void}
 */
function updateClientList(clients) {
  const $clientList = $('#ST-NewAge-socketio-clientList');
  $clientList.empty(); // 清空现有列表

  if (clients) {
    clients.forEach(client => {
      const option = `<option value="${client.id}">${client.id} - ${client.description}</option>`;
      $clientList.append(option);
    });
  }

  // 触发 change 事件 (如果需要)
  $clientList.trigger('change');
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
  const serverAddress = $('#ST-NewAge-socketio-serverAddressInput').val();
  const serverPort = $('#ST-NewAge-socketio-serverPortInput').val();
  fullServerAddress = `${serverAddress}:${serverPort}`;

  clientId = generateClientId();
  clientDesc = `本客户端是扩展端，运行于 ${getSillyTavernPort()} 端口`;

  let sillyTavernMasterKey = null;

  // 临时主连接 (用于认证, 获取初始信息)
  tempMainSocket = createNamedSocket(
    NAMESPACES.SILLY_TAVERN,
    {
      clientType: 'extension_tempMainSocket',
      clientId: clientId,
      desc: clientDesc,
      key: 'getKey',
    },
    false,
    true,
  );

  tempMainSocket.connect();

  // 使用 Promise 包装获取 sillyTavernMasterKey 的逻辑
  sillyTavernMasterKey = await new Promise((resolve, reject) => {
    tempMainSocket.on('connect', () => {
      tempMainSocket.emit(MSG_TYPE.IDENTIFY_SILLYTAVERN, { clientId }, response => {
        if (response.status === 'ok' && response.key) {
          console.log('sillyTavernMasterKey:', response.key);
          resolve(response.key); // 成功获取 key，resolve Promise
        } else if (response.status === 'warning' && response.key) {
          console.warn('warning about sillyTavernMasterKey:', response.message);
          resolve(response.key); // 收到警告，但仍获取到 key，resolve Promise
        } else {
          console.error('Failed to get sillyTavernMasterKey:', response.message);
          //toastr.error('Failed to get sillyTavernMasterKey.', 'Error');
          reject(response.message); // 获取 key 失败，reject Promise
        }
      });
    });

    // 添加错误处理，防止连接失败导致 Promise 永远不被 resolve/reject
    tempMainSocket.on('connect_error', error => {
      console.error('Connection error with tempMainSocket:', error);
      reject(error); // 连接错误，reject Promise
    });
  });

  // 确保获取到 sillyTavernMasterKey 后再继续
  if (sillyTavernMasterKey) {
    console.log('We got master key.');
    disconnectSocket(tempMainSocket); // 获取到 key 后断开临时连接

    // 创建主 Socket 连接
    llmSocket = createNamedSocket(
      NAMESPACES.LLM,
      {
        clientType: 'extension_mainSocket',
        clientId: clientId,
        desc: clientDesc,
        key: sillyTavernMasterKey, // 使用获取到的 key
      },
      false,
      true,
      10,
    );

    llmSocket.connect();
    globalThis.llmSocket = llmSocket; // 暴露给全局 (可选)
    console.log('socket:', llmSocket);

    llmSocket.on('connect', async () => {
      addLogMessage('success', '已连接到服务器', 'client');
      updateButtonState(true);
      $('#ST-NewAge-socketio-testBtn').prop('disabled', false);
      console.log('Socket.IO: Connected');
      toastr.success('Socket.IO: 已连接', 'Socket.IO');

      // 连接成功后，发送主密钥 (如果存在)  -- 这一步似乎不需要，因为已经在 createSocket 时传入了 key
      //sendMasterKey();

      setupLlmSocketListeners();

      // 创建其他命名空间的连接
      createNamespaceConnections();

      // 加载设置 (在主连接建立后)
      loadSettings();

      // 刷新房间和客户端列表
      refreshRoomList();
    });

    // 其他事件监听 (可选, 如果需要在默认命名空间监听其他事件)
    llmSocket.on('message', data => {
      /* ... */
      if (data.data === 'Yes,connection is fine.') {
        toastr.success('连接活跃!', '测试连接');
      }
    });
  } else {
    console.error('Failed to obtain SillyTavernMasterKey.  Socket not created.');
  }
}

// 在主连接建立后创建其他命名空间的连接
function createNamespaceConnections() {
  // AUTH 命名空间
  authSocket = createNamedSocket(
    NAMESPACES.AUTH,
    {
      clientType: 'extension_authSocket', // 可以使用不同的 clientType
      clientId: clientId,
      desc: clientDesc,
      key: llmSocket.auth.key, // 使用主连接的密钥
    },
    true,
  );
  authSocket.connect();
  setupLlmSocketListeners(); // 设置 LLM 相关的监听器

  // Function Call 命名空间
  functionCallSocket = createNamedSocket(
    NAMESPACES.FUNCTION_CALL,
    {
      clientType: 'extension_functionCallSocket',
      clientId: clientId,
      desc: clientDesc,
      key: llmSocket.auth.key,
    },
    true,
  );
  functionCallSocket.connect();
  setupFunctionCallSocketListeners();

  // Rooms 命名空间
  roomsSocket = createNamedSocket(
    NAMESPACES.CLIENTS,
    {
      clientType: 'extension_roomsSocket',
      clientId: clientId,
      desc: clientDesc,
      key: llmSocket.auth.key,
    },
    true,
  );
  roomsSocket.connect();
  setupRoomsSocketListeners();

  // Clients 命名空间
  clientsSocket = createNamedSocket(
    NAMESPACES.CLIENTS,
    {
      clientType: 'extension_clientsSocket',
      clientId: clientId,
      desc: clientDesc,
      key: llmSocket.auth.key,
    },
    true,
  );
  clientsSocket.connect();
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

//暂时不需要AUTH命名空间，除非登陆认证机制被修好
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

  initClientKeys();

  clientsSocket.emit(MSG_TYPE.UPDATE_CONNECTED_CLIENTS, {}, response => {
    if (response.status === 'ok') {
      console.log('Initial connected clients:', response.clients);
      updateClientList(response.clients);
    } else {
      console.error('Failed to get initial connected clients:', response.message);
    }
  });

  // 监听服务器发送的 connectedClients 更新
  clientsSocket.on(MSG_TYPE.CONNECTED_CLIENTS_UPDATE, data => {
    console.log('Received connected clients update:', data.clients);
    updateClientList(data.clients);
  });

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

/**
 * @description 测试与 Socket.IO 服务器的连接 / Tests the connection with the Socket.IO server.
 * @function onTestClick
 * @returns {void}
 */
function onTestClick() {
  if (llmSocket && llmSocket.connected) {
    import('./lib/non_stream.js').then(module => {
      module.sendNonStreamMessage(llmSocket, 'Connection active?');
    });
  }
}

/**
 * @description 更新转发选项的可见性 / Updates the visibility of forwarding options.
 * @function updateForwardingOptionsVisibility
 * @returns {void}
 */
function updateForwardingOptionsVisibility() {
  const defaultForwardingChecked = $('#ST-NewAge-socketio-defaultForwarding').is(':checked');
  $('#ST-NewAge-message-handling-options').toggle(true);

  if (defaultForwardingChecked) {
    $('#ST-NewAge-socketio-enableStream').parent().hide();
    $('#ST-NewAge-socketio-enableNonStream').parent().hide();
  } else {
    $('#ST-NewAge-socketio-enableStream').parent().show();
    $('#ST-NewAge-socketio-enableNonStream').parent().show();
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
  if ($('#ST-NewAge-socketio-enableStream').is(':checked') && $('#ST-NewAge-socketio-enableNonStream').is(':checked')) {
    console.warn('流式转发和非流式转发不能同时启用。已禁用所有转发。');
    toastr.warning('流式转发和非流式转发不能同时启用。已禁用所有转发。', '配置错误');
    messageForwarder.disableStreamForwarding();
    messageForwarder.disableNonStreamForwarding();
    $('#ST-NewAge-socketio-enableStream').prop('checked', false);
    $('#ST-NewAge-socketio-enableNonStream').prop('checked', false);
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
    return;
  }

  if (llmRequestQueue.length > 0) {
    isProcessingRequest = true;

    // 在处理新请求之前，处理上一个 LLM 响应
    if (previousLLMResponse && previousRequest) {
      const lastRequestId = previousRequest.clientMessageId;
      //const lastRequestType = llmRequestQueue.length > 1 ? llmRequestQueue.at(-2).requestType : 'newMessage';
      const lastRequestType = previousRequest.requestType;

      if (lastRequestType === 'newMessage') {
        // 对于 newMessage，已经在 handleLlmRequest 中创建了新的消息楼层，
        // 这里不需要做任何事情。
        // 可以在这里添加日志，以确认 newMessage 的行为。
        //setChatMessage({ message: previousLLMResponse }, lastRequestId + 1, { swipe_id: 0, refresh: 'display_and_render_current' });
        console.log('Previous request was newMessage.  No action needed here.');
      } else if (lastRequestType === 'regenerateMessage') {
        // 对于 regenerateMessage，替换当前消息楼层的最后一个消息页的内容
        setChatMessage({ message: previousLLMResponse }, lastRequestId, {
          swipe_id: 'current',
          refresh: 'display_and_render_current',
        });
      }
      previousLLMResponse = null; // 清空 previousLLMResponse
    }

    const request = llmRequestQueue.shift();
    previousRequest = request; //新增

    try {
      await iframeGenerate(request.generateConfig);
      // 生成的文本会通过事件监听器自动进行处理，无需在此进行处理
    } catch (error) {
      console.error('生成文本时出错:', error);
      addLogMessage('fail', `生成文本时出错: ${error}`, 'client', request.requestId);

      if (llmSocket && llmSocket.connected) {
        llmSocket.emit(MSG_TYPE.ERROR, {
          type: MSG_TYPE.ERROR,
          message: '生成文本时出错',
          error: error.message,
          requestId: request.requestId,
        });
      }
    } finally {
      isProcessingRequest = false;
      processRequest();
    }
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

  // 立即设置客户端请求文本 (新的消息楼层)
  const clientMessageId = chat.length; // 获取新添加的消息楼层的 ID
  setChatMessage({ message: data.message }, clientMessageId, { refresh: 'none' });

  const generateConfig = {
    user_input: data.message,
    stream: globalThis.isLLMStreamOutput,
  };

  // 将请求添加到队列，并设置 isExpectingLLMResponse 为 true
  llmRequestQueue.push({
    generateConfig,
    requestId: data.requestId,
    target: data.target,
    requestType: data.requestType, // 存储 requestType
    clientMessageId: clientMessageId,
  });
  isExpectingLLMResponse = true; // 设置标志
  processRequest();
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
  const roomList = $('#ST-NewAge-socketio-roomList');
  roomList.empty(); // 清空现有列表

  if (rooms.length === 0) {
    roomList.append('<tr><td colspan="3">No rooms yet.</td></tr>');
    return;
  }

  // 获取每个房间的客户端数量和详细信息
  for (const roomName of rooms) {
    const clients = await getClientsInRoom(roomName);
    const clientCount = clients.length;

    const row = $(`
            <tr>
                <td>${roomName}</td>
                <td>${clientCount}</td>
                <td>
                    <div class="ST-NewAge-operation-btn-container">
                        <button class="ST-NewAge-menu_button ST-NewAge-operation-btn" data-room="${roomName}">操作</button>
                    </div>
                </td>
            </tr>
        `);
    roomList.append(row);
  }

  // 为 "操作" 按钮添加点击事件
  $('.ST-NewAge-operation-btn')
    .off('click')
    .on('click', function (event) {
      event.stopPropagation(); // 阻止事件冒泡到 document

      const roomName = $(this).data('room');
      const submenu = $('.ST-NewAge-room-submenu');
      const btnOffset = $(this).offset(); // 获取按钮位置

      // 设置次级菜单的位置和房间名数据
      submenu.data('room', roomName);
      submenu.css({
        top: btnOffset.top + $(this).outerHeight(), // 位于按钮下方
        left: btnOffset.left,
      });

      // 显示次级菜单
      submenu.show();
    });

  // 为 "细节" 按钮添加点击事件
  $('.ST-NewAge-room-submenu .ST-NewAge-details-btn')
    .off('click')
    .on('click', function () {
      const roomName = $('.ST-NewAge-room-submenu').data('room');
      displayRoomDetails(roomName);
      $('.ST-NewAge-room-submenu').hide(); //关闭菜单
    });

  // 为 "踢出" 按钮添加点击事件
  $('.ST-NewAge-room-submenu .ST-NewAge-leave-btn')
    .off('click')
    .on('click', function () {
      const roomName = $('.ST-NewAge-room-submenu').data('room');
      removeClientFromRoom(socket, clientId, roomName).then(success => {
        if (success) {
          refreshRoomList(); // 刷新房间列表
        }
      });
      $('.ST-NewAge-room-submenu').hide(); //关闭菜单
    });

  // 为 "加入" 按钮添加点击事件
  $('.ST-NewAge-room-submenu .ST-NewAge-join-btn')
    .off('click')
    .on('click', function () {
      const roomName = $('.ST-NewAge-room-submenu').data('room');
      addClientToRoom(socket, clientId, roomName);
      $('.ST-NewAge-room-submenu').hide(); //关闭菜单
    });
  // 点击文档的其他地方时隐藏次级菜单
  $(document).on('click', function (event) {
    if (!$(event.target).closest('.ST-NewAge-room-submenu').length) {
      $('.ST-NewAge-room-submenu').hide();
    }
  });

  updateDeleteRoomSelect(rooms);

  // 自动加入第一个房间
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
  const select = $('#ST-NewAge-socketio-deleteRoomSelect');
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
  const detailsDiv = $('#ST-NewAge-room-details');
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

// 全局变量，存储 clientsSocket
let inMemoryClientKeys = {}; // 在内存中存储客户端密钥

// 新增：初始化客户端密钥
async function initClientKeys() {
  // 确保 clientsSocket 已经连接
  console.log('clientsSocket:', clientsSocket);
  if (!clientsSocket) {
    console.warn('clientsSocket is not connected yet.');
    return;
  }

  clientsSocket.emit(MSG_TYPE.GET_ALL_CLIENT_KEYS, {}, response => {
    if (response.status === 'ok') {
      console.log('All client keys:', response.keys);
      // 将密钥存储在内存中
      loadClientKeys(response.keys);
      updateClientList(); // 刷新客户端列表 (如果你有这个函数)
    } else {
      console.error('Failed to get all client keys:', response.message);
      toastr.error(response.message || 'Failed to get all client keys.', 'Error');
    }
  });
}

//存储密钥
function loadClientKeys(keys) {
  inMemoryClientKeys = keys;
}

// 新增: 生成并显示客户端密钥
async function generateAndDisplayClientKey() {
  const selectedClientId = $('#ST-NewAge-socketio-clientList').val();
  if (!selectedClientId) {
    toastr.warning('请选择一个客户端', '错误');
    return;
  }
  // 使用 clients 命名空间
  clientsSocket.emit(MSG_TYPE.GENERATE_CLIENT_KEY, { clientId, targetClientId: selectedClientId }, response => {
    if (response.status === 'ok') {
      $('#ST-NewAge-socketio-clientKeyDisplay').text(response.key).attr('title', response.key);
      //更新内存
      inMemoryClientKeys[selectedClientId] = response.key;
      updateClientList();
    } else {
      toastr.error(response.message || 'Failed to generate key.', 'Error');
    }
  });
}
// 新增: 复制客户端密钥
function copyClientKey() {
  const key = $('#ST-NewAge-socketio-clientKeyDisplay').text();
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
  const selectedClientId = $('#ST-NewAge-socketio-clientList').val();
  if (!selectedClientId) {
    toastr.warning('请选择一个客户端', '错误');
    return;
  }

  // 使用 clients 命名空间
  clientsSocket.emit(MSG_TYPE.REMOVE_CLIENT_KEY, { clientId, targetClientId: selectedClientId }, response => {
    if (response.status === 'ok') {
      toastr.success('客户端密钥已移除', '成功');
      $('#ST-NewAge-socketio-clientKeyDisplay').text(''); // 清空显示
      delete inMemoryClientKeys[selectedClientId]; // 从内存中移除
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
        $('#ST-NewAge-socketio-serverPortInput').val(settings.serverPort || '4000');
        $('#ST-NewAge-socketio-serverAddressInput').val(settings.serverAddress || 'http://localhost');
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
    serverPort: $('#ST-NewAge-socketio-serverPortInput').val(),
    serverAddress: $('#ST-NewAge-socketio-serverAddressInput').val(),
    networkSafe: $('#ST-NewAge-socketio-networkSafeMode').is(':checked'),
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
      args: [`./settings/server_settings.json`, settings],
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

  $('#ST-NewAge-socketio-testBtn').on('click', onTestClick);
  $('#ST-NewAge-socketio-saveSettingsBtn').on('click', saveSettings);

  $('#ST-NewAge-socketio-logFilter').on('change', filterLog);

  $('#ST-NewAge-socketio-refreshRoomsBtn').on('click', refreshRoomList);

  $('#ST-NewAge-socketio-connectBtn').on('click', connectToServerByHand);

  //$('#ST-NewAge-socketio-loginBtn').on('click', onLoginClick);
  //$('#ST-NewAge-socketio-logoutBtn').on('click', onLogoutClick);

  // testGenerate();

  checkRememberMe(); // 检查是否记住登录

  loadNetworkSafeSetting();

  $('#ST-NewAge-socketio-defaultForwarding').on('change', function () {
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

    if ($('#ST-NewAge-socketio-defaultForwarding').is(':checked')) {
      if (this.checked) {
        messageForwarder.enableStreamForwarding();
        messageForwarder.disableNonStreamForwarding();
      } else {
        messageForwarder.disableStreamForwarding();
        messageForwarder.enableNonStreamForwarding();
      }
    }
  });

  $('#ST-NewAge-socketio-enableStream').on('change', function () {
    if (!$('#ST-NewAge-socketio-defaultForwarding').is(':checked') && checkAndHandleMutex()) {
      return;
    }

    if (this.checked) {
      messageForwarder.enableStreamForwarding();
    } else {
      messageForwarder.disableStreamForwarding();
    }
  });

  $('#ST-NewAge-socketio-enableNonStream').on('change', function () {
    if (!$('#ST-NewAge-socketio-defaultForwarding').is(':checked') && checkAndHandleMutex()) {
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

  eventSource.on(event_types.STREAM_TOKEN_RECEIVED, data => {
    if (isExpectingLLMResponse) {
      // 检查标志
      if (messageForwarder.isStreamForwardingEnabled) {
        messageForwarder.handleStreamToken(data, messageForwarder.getMessageType(), llmRequestQueue.at(0)?.requestId);
      } else if (messageForwarder.isNonStreamForwardingEnabled) {
        messageForwarder.accumulateStreamData(data, llmRequestQueue.at(0)?.requestId);
      }
    } else {
      console.warn('Received LLM stream token without a corresponding request. Ignoring.');
      // 可以选择记录日志或采取其他操作
    }
  });

  eventSource.on(event_types.MESSAGE_RECEIVED, messageId => {
    if (isExpectingLLMResponse) {
      // 检查标志
      if (!globalThis.isLLMStreamOutput) {
        messageForwarder.handleNonStreamMessage(
          messageId,
          messageForwarder.getMessageType(),
          llmRequestQueue.at(0)?.requestId,
        );
      }
    } else {
      console.warn('Received LLM message without a corresponding request. Ignoring.');
      // 可以选择记录日志或采取其他操作
    }
  });

  let generationStartedHandled = false;

  eventSource.on(event_types.GENERATION_STARTED, () => {
    //向LLM发送请求，流式和非流式都是会触发这个事件
    if (isExpectingLLMResponse && !generationStartedHandled) {
      // 只有在预期 LLM 响应 且 generationStartedHandled 为 false 时才执行
      messageForwarder.setNewOutputId();
      messageForwarder.resetPreviousLLMData();
      generationStartedHandled = true;
    }
  });

  eventSource.on(event_types.GENERATION_ENDED, () => {
    //成功接收所有文本，流式和非流式都会触发该事件
    if (isExpectingLLMResponse) {
      // 获取完整的 LLM 响应文本
      previousLLMResponse = messageForwarder.messages;
      console.log('previousLLMResponse', previousLLMResponse);
      messageForwarder.resetOutputId();
      messageForwarder.resetPreviousLLMData();
      generationStartedHandled = false;
      isExpectingLLMResponse = false; // 重置标志
    }
  });

  eventSource.on(event_types.GENERATION_STOPPED, () => {
    // 通常来说GENERATION_STOPPED是受迫性的，即用户自主停止或者LLM响应自动停止
    if (isExpectingLLMResponse) {
      // 获取完整的 LLM 响应文本
      previousLLMResponse = messageForwarder.messages;
      console.log('previousLLMResponse', previousLLMResponse);
    }
    // 即使没有预期的响应也应该重置一下messageForwarder
    messageForwarder.resetOutputId();
    messageForwarder.resetPreviousLLMData();
    generationStartedHandled = false;
    if (isExpectingLLMResponse) {
      isExpectingLLMResponse = false;
    }
  });

  eventSource.on('js_generation_ended', generatedText => {
    console.log('生成结果:', generatedText);
  });

  // 新增：客户端密钥管理事件
  $('#ST-NewAge-socketio-generateKeyBtn').on('click', generateAndDisplayClientKey);
  $('#ST-NewAge-socketio-copyKeyBtn').on('click', copyClientKey);
  $('#ST-NewAge-socketio-removeKeyBtn').on('click', removeClientKey);

  // 初始隐藏一些元素
  $('.ST-NewAge-button-group').hide();
  $('.ST-NewAge-animated-details').hide();

  // 设置扩展识别名称和端口号 (只读)
  $('#ST-NewAge-socketio-extensionName').val(generateClientId()).attr('readonly', true);
  $('#ST-NewAge-socketio-localPortInput').val(getSillyTavernPort()).attr('readonly', true);
});
