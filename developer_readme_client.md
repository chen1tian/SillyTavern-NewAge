
# SillyTavern-NewAge 服务器客户端开发文档

本文档旨在帮助非 SillyTavern 扩展的客户端开发者（例如，独立的 Web 应用、桌面应用、移动应用）理解如何与 SillyTavern-NewAge 服务器进行交互。注意，你的客户端只能搭载在内部服务器（即我们写好的服务器）上，如果你的客户端运行在外部服务器上，请参考[外部服务器开发文档]()(待补充)。

## 目录

- [SillyTavern-NewAge 服务器客户端开发文档](#sillytavern-newage-服务器客户端开发文档)
  - [目录](#目录)
  - [概述](#概述)
  - [客户端设置：](#客户端设置)
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
  - [示例代码 (JavaScript)](#示例代码-javascript)
  - [注意事项](#注意事项)

## 概述

SillyTavern-NewAge 服务器是一个基于 Node.js 和 Socket.IO 的实时通信服务器，主要用于处理来自 SillyTavern 扩展和其他客户端的请求，并与大语言模型（LLM）交互。非 SillyTavern 客户端可以通过 Socket.IO 与服务器建立连接，发送请求并接收响应。

服务器通过不同的命名空间（namespaces）来组织不同的功能。客户端需要连接到相应的命名空间才能使用特定功能。

## 客户端设置：
  *   ### 如果不提前创建好JSON文件，服务器则无法连接你的客户端！！！
  *   请在 `/server/settings` 中手动或者在你的代码中调用 `/server/dist/function_call.js` 的 `saveJsonToFile` 自动以创建一个JSON文件，其名字最好与 `clientId` 同名。
  *   在JSON中，可参考如下写法：
  ```JSON
  {
    "clientId": "frontendExample",
    "isTrust": true
  }
  ```
  *   其中，`isTrust` 必须为 `true` ，否则服务器不会认为你这个客户端是可信的。

## 连接和认证

### 连接参数

*   **服务器地址**:  通常是 `http://localhost` 或服务器的 IP 地址。
*   **服务器端口**:  默认为 `4000`，但可以在服务器设置中配置。
*   **Socket.IO 路径**: `/socket.io` (通常不需要修改)。
*   **传输方式**:  `websocket` (推荐)。

### 认证流程 ( /auth 命名空间)

1.  **连接 /auth 命名空间**:  客户端在连接时需要提供以下认证信息 (在 `auth` 对象中):

    ```javascript
    {
      clientType: 'yourClientType', // 客户端类型 (见下文)
      clientId: 'yourClientId',     // 客户端的唯一 ID (由客户端生成，最好起一个辨别度高并且不容易重名的名字)
      key: 'yourClientKey',       // 客户端密钥 (用于验证客户端身份)
      desc: 'yourClientDescription' // 客户端描述 (可选)
    }
    ```
    在连接时，如果不知道`key`，请前往扩展端生成并复制一个key

2.  **密钥验证**:
    *   服务器会验证 `clientId` 和 `key` 是否匹配。
    *   如果密钥无效，则会直接断连。
    *   如果密钥有效，客户端将加入以其 `clientId` 命名的房间。

### 客户端类型

`clientType` 可以是以下值之一：

*   `'extension'`： SillyTavern 扩展 (请不要使用此类型)。
*   `'monitor'`： 监控客户端 (用于监控服务器状态)。
*   `'yourClientType'`： 你可以自定义客户端类型，例如 `'web-app'`, `'desktop-app'`, `'mobile-app'` 等。

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

1.  **连接 /llm 命名空间**:

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

2.  **发送 `MSG_TYPE.LLM_REQUEST` 事件**:

    ```javascript
    const requestId = generateUniqueId(); // 生成一个唯一的请求 ID
    socket.emit(MSG_TYPE.LLM_REQUEST, {
      target: 'targetSillyTavernClientId', // 目标 SillyTavern 的 clientId
      requestId: requestId,
      message: message,//输入的文本信息
      // ... 其他 LLM 请求参数 (取决于你的 LLM 接口) ...
      //当前仅支持文本请求，前端助手支持的更多键值在将来会逐步完善
    });
    ```

### 接收流式响应

1.  **监听 `streamed_data` 事件**:

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

1.  **连接 /function\_call 命名空间**:  (与连接 /llm 命名空间类似)。

2.  **发送 `MSG_TYPE.FUNCTION_CALL` 事件**:

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

## 示例代码 (JavaScript)

```javascript
import io from 'socket.io-client';
import ss from '@sap_oss/node-socketio-stream';
import { MSG_TYPE } from './lib/constants.js'; // 假设你把 constants.js 复制过来了

const serverAddress = 'http://localhost';
const serverPort = 4000;
const clientId = 'my-web-app-' + Math.random().toString(36).substring(7); // 简化的 ID 生成，也可以使用你想使用的方式，建议使用UUIDv4
const clientKey = 'my-secret-key'; // 从扩展那边获取

const socket = io(`${serverAddress}:${serverPort}/llm`, {
  auth: {
    clientType: 'web-app',
    clientId: clientId,
    key: clientKey,
    desc: 'My Web Application'
  }
});

socket.on('connect', () => {
  console.log('Connected to server');

  // 发送 LLM 请求 (示例)
  const requestId = 'llm-request-' + Math.random().toString(36).substring(7);
  socket.emit(MSG_TYPE.LLM_REQUEST, {
    target: 'SillyTavern-1', // 替换为实际的 SillyTavern clientId
    requestId: requestId,
    message: 'Translate the following English text to French: "Hello, world!"',
    // ... 其他 LLM 参数 ...
  });
});

ss(socket).on('streamed_data', (stream, data) => {
  console.log(`Received stream for request ${data.requestId}, stream ${data.streamId}`);

  stream.on('data', (chunk) => {
    console.log('Received chunk:', chunk.toString());
  });

  stream.on('end', () => {
    console.log('Stream ended');
  });

  stream.on('error', (error) => {
    console.error('Stream error:', error);
  });
});

socket.on(MSG_TYPE.ERROR, (error) => {
  console.error('Server error:', error.message);
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected from server:', reason);
});
```

## 注意事项

*   **安全性**:  客户端密钥 (`key`) 应该安全地存储，不要暴露在客户端代码中。  考虑使用环境变量或其他安全机制。
*   **错误处理**:  务必处理 Socket.IO 和服务器可能发生的各种错误。
*   **请求 ID**:  对于每个请求，都应该生成一个唯一的 `requestId`，以便将响应与请求正确地关联起来。
*   **目标 SillyTavern**:  在发送 LLM 请求或函数调用时，需要指定目标 SillyTavern 的 `clientId` (除非你调用的是服务器端函数)。
*  **`@sap_oss/node-socketio-stream`**: 此库是必须的, 用于处理服务器和客户端之间的流式数据传输。
* **消息类型和常量**：请参考`lib/constants.js`的内容。
