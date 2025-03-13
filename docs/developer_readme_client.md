
# SillyTavern-NewAge 服务器客户端开发文档

本文档旨在帮助非 SillyTavern 扩展的客户端开发者（例如，独立的 Web 应用、桌面应用、移动应用）理解如何与 SillyTavern-NewAge 服务器进行交互。注意，你的客户端只能搭载在内部服务器（即我们写好的服务器）上，如果你的客户端运行在外部服务器上，请参考[外部服务器开发文档]()(待补充)。

## 目录

- [SillyTavern-NewAge 服务器客户端开发文档](#sillytavern-newage-服务器客户端开发文档)
  - [目录](#目录)
  - [概述](#概述)
  - [客户端设置](#客户端设置)
  - [连接和认证](#连接和认证)
    - [连接参数](#连接参数)
    - [认证流程 ( /auth 命名空间)](#认证流程--auth-命名空间)
    - [客户端类型](#客户端类型)
  - [命名空间和事件](#命名空间和事件)
    - [通用事件](#通用事件)
    - [/ (默认命名空间)](#-默认命名空间)
    - [/auth](#auth)
    - [/llm](#llm)
    - [/function\_call](#function_call)
    - [/clients](#clients)
    - [/rooms](#rooms)
    - [/sillytavern](#sillytavern)
  - [LLM 交互 ( /llm 命名空间)](#llm-交互--llm-命名空间)
    - [发送 LLM 请求](#发送-llm-请求)
    - [接收流式响应](#接收流式响应)
    - [接收非流式响应](#接收非流式响应)
  - [函数调用 ( /function\_call 命名空间)](#函数调用--function_call-命名空间)
  - [客户端管理 ( /clients 命名空间)](#客户端管理--clients-命名空间)
  - [房间管理 ( /rooms 命名空间)](#房间管理--rooms-命名空间)
  - [错误处理](#错误处理)
  - [其他消息格式](#其他消息格式)
  - [最佳实践(JavaScript)](#最佳实践javascript)
  - [注意事项](#注意事项)

## 概述

SillyTavern-NewAge 服务器是一个基于 Node.js 和 Socket.IO 的实时通信服务器，主要用于处理来自 SillyTavern 扩展和其他客户端的请求，并与大语言模型（LLM）交互。非 SillyTavern 客户端可以通过 Socket.IO 与服务器建立连接，发送请求并接收响应。

服务器通过不同的命名空间（namespaces）来组织不同的功能。客户端需要连接到相应的命名空间才能使用特定功能。

## 客户端设置

- ### 如果不提前创建好JSON文件，服务器则无法连接你的客户端

- 请在 `/server/settings` 中手动或者在你的代码中调用 `/server/dist/function_call.js` 的 `saveJsonToFile` 自动以创建一个JSON文件，其名字最好与 `clientId` 同名。
- 在JSON中，可参考如下写法：

  ```JSON
  {
    "clientId": "frontendExample",
    "isTrust": true
  }
  ```

- 其中，`isTrust` 必须为 `true` ，否则服务器不会认为你这个客户端是可信的。

## 连接和认证

### 连接参数

- **服务器地址**:  通常是 `http://localhost` 或服务器的 IP 地址。
- **服务器端口**:  默认为 `4000`，但可以在服务器设置中配置。
- **Socket.IO 路径**: `/socket.io` (通常不需要修改)。
- **传输方式**:  `websocket` (推荐)。

### 认证流程 ( /auth 命名空间)

1. **连接 /auth 命名空间**:  客户端在连接时需要提供以下认证信息 (在 `auth` 对象中):

    ```javascript
    {
      clientType: 'yourClientType', // 客户端类型 (见下文)
      clientId: 'yourClientId',     // 客户端的唯一 ID (由客户端生成，最好起一个辨别度高并且不容易重名的名字)
      key: 'yourClientKey',       // 客户端密钥 (用于验证客户端身份)
      desc: 'yourClientDescription' // 客户端描述 (可选)
    }
    ```

    在连接时，如果不知道`key`，请前往扩展端生成并复制一个key

2. **密钥验证**:
    - 服务器会验证 `clientId` 和 `key` 是否匹配。
    - 如果密钥无效，则会直接断连。
    - 如果密钥有效，客户端将加入以其 `clientId` 命名的房间。

### 客户端类型

`clientType` 可以是以下值之一：

- `'extension'`： SillyTavern 扩展 (请不要使用此类型)。
- `'monitor'`： 监控客户端 (用于监控服务器状态)。
- `'yourClientType'`： 你可以自定义客户端类型，例如 `'web-app'`, `'desktop-app'`, `'mobile-app'` 等。

## 命名空间和事件

### 通用事件

| 事件名          | 命名空间 | 描述                                 | 数据                                                                                   |
| :-------------- | :------- | :----------------------------------- | :------------------------------------------------------------------------------------- |
| `connect`       | 所有     | 连接成功建立时触发。                 | 无                                                                                     |
| `connect_error` | 所有     | 连接发生错误时触发。                 | `error`: 错误对象                                                                      |
| `disconnect`    | 所有     | 连接断开时触发。                     | `reason`: 断开连接的原因                                                               |
| `message`       | 多个     | 接收到非流式消息时触发 (见下文)。   | `{ type, data, source, requestId, outputId, clientId }` (根据消息类型，可能有其他字段) |
|`MSG_TYPE.ERROR`|多个|接收到错误消息时触发|`{type,message,requestId}`|

### / (默认命名空间)

| 事件名      | 描述                       | 数据 |
| :---------- | :------------------------- | :--- |
| (无特定事件) | 主要用于 `monitor` 客户端 |      |

### /auth

| 事件名                       | 描述                                                         | 数据                                                                   |
| :--------------------------- | :----------------------------------------------------------- | :--------------------------------------------------------------------- |
| `MSG_TYPE.TEMP_ROOM_ASSIGNED` | 客户端密钥无效，被分配到临时房间时触发。                     | `{ roomId: string }`                                                   |
| `MSG_TYPE.GET_CLIENT_KEY`     | (服务器 -> 客户端) 获取客户端密钥, 通常在`key`为`getKey`时返回 | `{ type: MSG_TYPE.GET_CLIENT_KEY, key: string, clientId: string }` |
| `MSG_TYPE.LOGIN`              | (客户端 -> 服务器) 验证 SillyTavern 密码 (SillyTavern 专用)。 | `{ clientId: string, password: string }`                               |

### /llm

| 事件名           | 描述                                                         | 数据                                                                                                                     |
| :--------------- | :----------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| `MSG_TYPE.LLM_REQUEST` | (客户端 -> 服务器) 发送 LLM 请求。                           | `{ target: string, requestId: string, ... }` (其他字段取决于 LLM 接口)                                               |
| `streamed_data`  | (服务器 -> 客户端) 接收流式 LLM 响应。                       | `{ streamId: string, outputId: string, requestId: string, source: 'server' }`, 以及一个可读流 (使用 `@sap_oss/node-socketio-stream`) |

### /function\_call

| 事件名              | 描述                                                        | 数据                                                                                                |
| :------------------ | :---------------------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| `MSG_TYPE.FUNCTION_CALL` | (客户端/服务器) 发送或接收函数调用请求。                | `{ requestId: string, functionName: string, args: any[], target: string }`                             |

### /clients

主要用于服务器对客户端进行管理，普通客户端不常用。

### /rooms

 客户端通常不需要直接和`/rooms`交互，`/rooms`主要用于管理房间和客户端。

### /sillytavern

这个命名空间主要用于服务器和 SillyTavern 扩展之间的通讯, 客户端通常不需要直接和 `/sillytavern` 命名空间交互。

## LLM 交互 ( /llm 命名空间)

### 发送 LLM 请求

1. **连接 /llm 命名空间**:

    ```javascript
    const socket = io(`${serverAddress}:${serverPort}/llm`, {
      auth: {
        clientType: 'yourClientType',//必需
        clientId: 'yourClientId',//必需
        key: 'yourClientKey',//必需
        desc: 'yourClientDescription'//可选
      }
    });
    ```

2. **发送 `MSG_TYPE.LLM_REQUEST` 事件**:

    ```javascript
    const requestId = generateUniqueId(); // 生成一个唯一的请求 ID
    socket.emit(MSG_TYPE.LLM_REQUEST, {
      target: 'targetSillyTavernClientId', // 目标 SillyTavern 的 clientId
      requestId: requestId,
      message: message,//输入的文本信息
      requestType: newMessage,//用于控制生成文本的行为，有两种类型：生成新的文本(newMessage);重新生成(regenerateMessage)
      // ... 其他 LLM 请求参数 (取决于LLM 接口) ...
      //当前仅支持文本请求，前端助手支持的更多键值在将来会逐步完善
    });
    ```

### 接收流式响应

1. **监听 `streamed_data` 事件**:

    ```javascript
    import ss from '@sap_oss/node-socketio-stream';

    ss(socket).on('streamed_data', (stream, data) => {
      console.log(`Received stream for request ${data.requestId}, stream ${data.streamId}`);

      stream.on('data', (chunk) => {
        // 处理接收到的数据块
        console.log('Received chunk:', chunk.toString());
      });

      stream.on('end', () => {
        // 流结束
        console.log('Stream ended');
      });

      stream.on('error', (error) => {
        // 流错误
        console.error('Stream error:', error);
      });
    });
    ```

### 接收非流式响应

直接通过`message`事件来接收：

```javascript
    socket.on('message', (data) => {
        console.log(data)
    }
```

## 函数调用 ( /function\_call 命名空间)

1. **连接 /function\_call 命名空间**:  (与连接 /llm 命名空间类似)。

2. **发送 `MSG_TYPE.FUNCTION_CALL` 事件**:

    ```javascript
    const requestId = generateUniqueId();
    socket.emit(MSG_TYPE.FUNCTION_CALL, {
      requestId: requestId,
      functionName: 'functionToCall',
      args: [arg1, arg2, ...],
      target: 'server'  // 或目标 SillyTavern 的 clientId
    }, (response) => {
      // 处理响应
      if (response.success) {
        console.log('Function call result:', response.result);
      } else {
        console.error('Function call error:', response.error);
      }
    });
    ```

## 客户端管理 ( /clients 命名空间)

普通客户端不常用。

## 房间管理 ( /rooms 命名空间)

普通客户端不常用。

## 错误处理

客户端应该监听 `MSG_TYPE.ERROR` 事件来处理服务器发送的错误消息：

```javascript
socket.on(MSG_TYPE.ERROR, (error) => {
  console.error('Server error:', error.message);
  // 根据错误类型和 requestId 进行处理
});
```

## 其他消息格式

客户端和服务器之间的消息通常遵循以下 JSON 格式：

```json
{
  "type": "消息类型 (例如 MSG_TYPE.LLM_REQUEST, MSG_TYPE.FUNCTION_CALL 等)",
  "requestId": "唯一请求 ID",
  "source": "消息来源 ('server' 或客户端 ID)",
  "clientId": "发送消息的客户端 ID",
  "...": "其他数据 (根据消息类型而定)"
}
```

## 最佳实践(JavaScript)

```javascript
// monitor.js

import { STREAM_EVENTS, MSG_TYPE, NAMESPACES } from '../../lib/constants.js';
import { uuidv4 } from '../../lib/uuid/uuid.js';

import * as ss from '../../lib/@sap_oss/node-socketio-stream.js';
import { io } from '../../lib/Socket.io/socket.io.js';

import { saveJsonToFile } from '../../dist/function_call.js'

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

// 该客户端的设置
const settings = {
  "clientId": clientId,
  "isTrust": true
}
/**
 * 保存客户端设置到指定的路径 
*/
async function saveJson() {
  let result;
  try {
    result = saveJsonToFile(`../../settings/${clientId}-settings.json`, settings);
    console.log("Save Json success!");
  }
  catch {
    console.error("Save Json error,reason:", result.error)
  }
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

function sendMessage(message, requestType) {
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
      requestType: requestType,
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

// 自动保存该客户端的设置
saveJson();

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
    sendMessage(message, 'newMessage');
    messageInput.value = '';
  });

  messageInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const message = messageInput.value;
      sendMessage(message, 'newMessage');
      messageInput.value = '';
    }
  });

  const cleanup = streamToElement(llmSocket, STREAM_EVENTS.streamed_data, streamDataTextArea, {
    updateInterval: 300,
    maxBufferSize: 2 * 1024 * 1024,
    debug: true,
  });
});

```

## 注意事项

- **安全性**:  客户端密钥 (`key`) 应该安全地存储，不要暴露在客户端代码中。  考虑使用环境变量或其他安全机制。
- **错误处理**:  务必处理 Socket.IO 和服务器可能发生的各种错误。
- **请求 ID**:  对于每个请求，都应该生成一个唯一的 `requestId`，以便将响应与请求正确地关联起来。
- **目标 SillyTavern**:  在发送 LLM 请求或函数调用时，需要指定目标 SillyTavern 的 `clientId` (除非你调用的是服务器端函数)。
- **`@sap_oss/node-socketio-stream`**: 此库是必须的, 用于处理服务器和客户端之间的流式数据传输。
- **消息类型和常量**：请参考`lib/constants.js`的内容。
