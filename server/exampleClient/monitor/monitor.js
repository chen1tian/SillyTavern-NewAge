// monitor.js

import { STREAM_EVENTS, MSG_TYPE, NAMESPACES } from '../../lib/constants.js';
import { uuidv4 } from '../../lib/uuid/uuid.js';

import * as ss from '../../lib/@sap_oss/node-socketio-stream.js';
import { io } from '../../lib/Socket.io/socket.io.js';

const streamDataTextArea = document.getElementById('streamDataTextArea');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');

const serverAddress = 'http://localhost';
const serverPort = 4000;
const fullServerAddress = serverAddress + ':' + serverPort;

const clientType = 'monitor';
const clientId = 'monitor';

// 认证信息
const authData = {
  clientType: 'monitor',
  clientId: 'monitor',
  key: '2b$10$tBhT3d0vsSo66fthSdbdXeYNCA8DZpUCMS.xD3r.8SY82F/RjCkvW',
  desc: '服务器监控网页',
};

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
    console.error(`Socket.IO [${namespace}],clientType:${initSocket.auth.clientType}: Connection error`, error);
    console.log(
      `Socket.IO [${namespace}], clientType:${initSocket.auth.clientType}: Disconnected. Reason: ${reason}, ID: ${initSocket.id}, Last Received: ${lastReceived}, Last Sent: ${lastSent}`,
    );
    //toastr.error(`[${namespace}] 连接错误: ${error}`, 'Socket.IO');
  });

  initSocket.on('disconnect', reason => {
    const lastReceived = initSocket.lastReceived ? new Date(initSocket.lastReceived).toISOString() : 'N/A';
    const lastSent = initSocket.lastSent ? new Date(initSocket.lastSent).toISOString() : 'N/A';

    console.log(
      `Socket.IO [${namespace}], clientType:${initSocket.auth.clientType}: Disconnected. Reason: ${reason}, ID: ${initSocket.id}, Last Received: ${lastReceived}, Last Sent: ${lastSent}`,
    );
    // toastr.warning(`[${namespace}] Disconnected. Reason: ${reason}`, 'Socket.IO');
  });

  initSocket.on('error', error => {
    console.error('Socket.IO Client Error:', error);
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

  const sleep = ms => new Promise(r => setTimeout(r, ms));

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

function disconnectSocket(socket) {
  console.log(`${socket.auth.clientType} is disconnect.`);
  socket.disconnect(true);
}

/**
 * 使用 socket.io-stream 接收流数据并实时更新到 HTML 元素，具有缓冲区功能。
 *
 * @param {object} socket - 已连接的 Socket.IO socket 对象。
 * @param {string} eventName - 服务器发送流数据的事件名称。
 * @param {string} elementId - HTML 元素的 ID。
 * @param {object} [options] - 可选配置对象。
 * @param {number} [options.updateInterval=200] - 更新间隔（毫秒），控制 DOM 更新频率。
 * @param {number} [options.maxBufferSize=1024 * 1024] - 缓冲区最大大小（字节），超过此大小则启用缓冲区。
 * @param {boolean} [options.debug=false] - 是否启用调试日志。
 *
 * @throws {TypeError} 如果参数类型不正确。
 * @throws {Error} 如果找不到元素或 Socket.IO 相关对象无效。
 *
 * @returns {function} 返回一个函数，调用该函数可以移除事件监听器。
 */
function streamToElement(socket, eventName, elementId, options = {}) {
  const { updateInterval = 200, maxBufferSize = 1024 * 1024, debug = false } = options;

  // --- 输入验证 ---
  if (!socket || typeof socket !== 'object') {
    throw new TypeError('socket 参数必须是一个有效的 Socket.IO socket 对象。');
  }
  if (typeof eventName !== 'string' || eventName.trim() === '') {
    throw new TypeError('eventName 参数必须是一个非空字符串。');
  }
  if (typeof elementId !== 'string' || elementId.trim() === '') {
    throw new TypeError('elementId 参数必须是一个非空字符串。');
  }
  if (typeof updateInterval !== 'number' || updateInterval < 0) {
    throw new TypeError('updateInterval 参数必须是一个非负数。');
  }
  if (typeof maxBufferSize !== 'number' || maxBufferSize <= 0) {
    throw new TypeError('maxBufferSize 参数必须是一个正数。');
  }
  if (typeof debug !== 'boolean') {
    throw new TypeError('debug 参数必须是一个布尔值。');
  }

  const element = document.getElementById(elementId);
  if (!element) {
    throw new Error(`找不到 ID 为 "${elementId}" 的元素。`);
  }

  if (!socket.on || typeof socket.on !== 'function') {
    throw new Error('传入的 socket 对象无效。 它需要一个有效的 Socket.IO socket 对象.');
  }

  if (!eventName || typeof eventName !== 'string') {
    throw new Error('传入的 eventName 无效。 它需要一个有效的 string 类型');
  }

  let accumulatedData = '';
  let lastUpdateTime = 0;
  let updateScheduled = false;
  let buffer = [];
  let buffering = false;
  let totalBufferedSize = 0;

  const dataHandler = chunk => {
    // 将 stream.on('data') 的处理函数提取出来
    const chunkSize = chunk.length;
    totalBufferedSize += chunkSize;

    if (buffering || totalBufferedSize > maxBufferSize) {
      buffering = true;
      buffer.push(chunk);
      if (debug) {
        console.log(`Buffering: ${buffer.length} chunks, total size: ${totalBufferedSize}`);
      }
    } else {
      accumulatedData += chunk.toString();
    }

    const now = Date.now();

    if (now - lastUpdateTime >= updateInterval && !updateScheduled) {
      updateScheduled = true;
      scheduleUpdate();
    }
  };

  const endHandler = () => {
    if (buffering) {
      processBuffer(); //process remaining data
    }

    if ('textContent' in element) {
      element.textContent = accumulatedData;
    } else {
      element.innerHTML = accumulatedData;
    }
    console.log('流传输结束');
  };

  const errorHandler = error => {
    console.error('流传输错误:', error);
  };

  const stream = ss(socket).stream; // 获取 ss.createStream() 方法
  const streamOn = ss(socket).on(eventName, stream => {
    //给stream.on 绑定一个变量
    stream.on('data', dataHandler);
    stream.on('end', endHandler);
    stream.on('error', errorHandler);
  });

  function scheduleUpdate() {
    requestAnimationFrame(() => {
      if (buffering) {
        processBuffer();
      }

      // 优先使用 textContent，其次使用 innerHTML
      if ('textContent' in element) {
        element.textContent = accumulatedData;
      } else {
        element.innerHTML = accumulatedData;
      }

      if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
        element.scrollTop = element.scrollHeight;
      }

      updateScheduled = false;
      lastUpdateTime = Date.now();
    });
  }

  function processBuffer() {
    while (buffer.length > 0) {
      const chunk = buffer.shift();
      accumulatedData += chunk.toString();
      totalBufferedSize -= chunk.length;
    }
    buffering = false;
  }

  // 返回一个清理函数
  return () => {
    if (streamOn && stream) {
      //streamOn 是一个Listener, 需要通过ss(socket).removeListener去清除
      ss(socket).removeListener(eventName, streamOn);
      stream.removeListener('data', dataHandler); //stream 是一个node emitter, 可以直接removeListener
      stream.removeListener('end', endHandler);
      stream.removeListener('error', errorHandler);
    }
  };
}

function sendMessage(message) {
  if (!message) {
    console.warn('Cannot send empty message.');
    return;
  }
  if (!llmSocket) {
    console.error('llmSocket is not initialized.');
    return;
  }
  if (SillyTavernId.length === 0) {
    console.warn('No SillyTavern extensions found.');
    return;
  }

  llmSocket.emit(
    MSG_TYPE.LLM_REQUEST,
    {
      target: SillyTavernId[0], // 确保 SillyTavernId[0] 存在
      requestId: uuidv4(),
      message: message,
    },
    response => {
      if (response.status === 'error') {
        console.error('ERROR! The message from the server or extension:', response.message);
      } else if (response.status === 'ok') {
        console.log('Success! The message from the server:', response.message);
      }
    },
  );
}

// 向服务器提交认证信息
const authsocket = newSocket(NAMESPACES.AUTH, authData, false, true);

authsocket.connect();

// 当然也可以向服务器申请密钥来实现自动化，但前提是网络环境为相对安全，参考如下
/*
const authData = = {
    clientType: 'monitor',
    clientId: 'monitor',
    key: 'getKey',
    desc: '服务器监控网页',
  } 
const authSocket = newSocket(NAMESPACES.AUTH, authData, true, true);

authSocket.on(MSG_TYPE.CLIENT_KEY , (data) =>){
  const key = data.Key;
  authData.key = key;
  }
*/

// 获取所有已经待命的SillyTavern的扩展的ID，这样就可以指定你想要对接的扩展实例（绝大多数情况下都是第一个)

let SillyTavernId = [];

authsocket.emit(MSG_TYPE.GET_SILLYTAVERN_EXTENSION, response => {
  if (response.status === 'ok') {
    SillyTavernId = response.allTheSTSocket;
  }
});

// 一般来说所有的Socket都需要authData以进行认证，除非网络环境为相对安全
const llmSocket = newSocket(NAMESPACES.LLM, authData, false, true);

llmSocket.connect();

const functionCallSocket = newSocket(NAMESPACES.FUNCTION_CALL, authData, false, true);

functionCallSocket.connect();

// 你可以像如下代码来加载你想要的静态资源，具体用法详见开发文档，也可以参考server.js的initializeStaticResources()
// 键：URL，值：文件相对于本js文件的相对路径
/* 
const initialResources = {}

functionCallSocket.emit(MSG_TYPE.FUNCTION_CALL, {
      requestId: requestId,
      functionName: 'addStaticResources',
      args: initialResources,
      target: 'server'  
    }, (response) => {
      if (response.success) {
        console.log('Function call result:', response.result);
      } else {
        console.error('Function call error:', response.error);
      }
    });
*/

llmSocket.on('connect', () => {
  console.log('llmSocket connected!');

  // 监听按钮点击和回车事件 (确保这些代码在 llmSocket 连接后执行)
  sendButton.addEventListener('click', () => {
    const message = messageInput.value;
    sendMessage(message);
    messageInput.value = '';
  });

  messageInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const message = messageInput.value;
      sendMessage(message);
      messageInput.value = '';
    }
  });

  const cleanup = streamToElement(llmSocket, STREAM_EVENTS.streamed_data, streamDataTextArea, {
    updateInterval: 300,
    maxBufferSize: 2 * 1024 * 1024,
    debug: true,
  });
});
