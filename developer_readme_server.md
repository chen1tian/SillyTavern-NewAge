
# SillyTavern-NewAge 服务器端开发文档

本文档旨在帮助开发者理解 SillyTavern-NewAge 扩展的服务器端代码结构、API 和开发流程。

## 目录

- [SillyTavern-NewAge 服务器端开发文档](#sillytavern-newage-服务器端开发文档)
  - [目录](#目录)
  - [文件结构](#文件结构)
  - [初始化流程](#初始化流程)
  - [模块和函数](#模块和函数)
    - [主服务器逻辑 (server.js)](#主服务器逻辑-serverjs)
    - [房间管理 (Rooms.js)](#房间管理-roomsjs)
    - [密钥管理 (Keys.js)](#密钥管理-keysjs)
    - [函数调用 (function\_call.js)](#函数调用-function_calljs)
    - [非流式消息处理 (non\_stream.js)](#非流式消息处理-non_streamjs)
    - [流式消息处理 (stream.js)](#流式消息处理-streamjs)
  - [命名空间 (NAMESPACES)](#命名空间-namespaces)
  - [消息类型 (MSG\_TYPE)](#消息类型-msg_type)
  - [事件](#事件)
  - [数据结构](#数据结构)
  - [开发指南](#开发指南)
  - [注意事项](#注意事项)

## 文件结构

```
server/
├── dist/
│   ├── function_call.js   (可供调用的函数)
│   ├── Rooms.js           (房间管理)
│   └── Keys.js            (密钥管理)
├── lib/
│   ├── constants.js      (常量定义)
│   ├── non_stream.js    (非流式消息处理)
│   ├── stream.js        (流式消息处理)
│   └── uuid.js          (UUID 生成)
├── settings/
│   ├── server_settings.json (服务器设置)
│   ├── {clientId}-settings.json (客户端设置, 自动生成)
│   └── ... 其他客户端设置文件
├── package.json
└── server.js            (服务器主入口)
```

## 初始化流程

1. **加载模块**：导入必要的 Node.js 模块和自定义模块。
2. **创建 Express 应用和 HTTP 服务器**：使用 `express` 和 `http` 模块创建服务器。
3. **创建 Socket.IO 服务器**：创建 Socket.IO 服务器实例，并配置 CORS。
4. **加载服务器设置**：
    - 从 `settings/server_settings.json` 文件加载服务器设置，如果文件不存在则创建。
    - 自动从 `settings/` 目录下加载可信客户端和 SillyTavern 扩展的配置 (根据 `clientId` 和 `isTrust` 字段)。
    - 自动哈希 `server_settings.json` 中未哈希的 SillyTavern 密码。
5. **定义全局变量**：定义请求映射 (`llmRequests`)、可信客户端/SillyTavern 集合等变量。
6. **注册 `function_call` 函数**：遍历 `function_call.js` 中导出的函数，并使用 `registerFunction()` 注册到 `functionRegistry`。
7. **设置 Socket.IO 事件监听器**：在不同的命名空间中设置事件监听器，处理客户端连接、消息、断开连接等事件。
8. **启动 HTTP 服务器**：调用 `httpServer.listen()` 启动服务器。

## 模块和函数

### 主服务器逻辑 (server.js)

| 函数名                        | 描述                                                                                                     | 参数                                                                          | 返回值             |
| :---------------------------- | :------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------- | :----------------- |
| `loadServerSettings()`        | 加载服务器设置、自动设置可信客户端/SillyTavern、确保 SillyTavern 密码已哈希。                            | 无                                                                            | `Promise<void>`    |
| `saveServerSettings()`        | 将服务器设置保存到 `settings/server_settings.json` 文件。                                                | `newSettings`: 要保存的新设置                                                 | 无                 |
| `processLLMRequest()`         | 处理 LLM 请求 (将请求转发给目标 SillyTavern)。                                                           | `target`: 目标 SillyTavern 的 `clientId`, `request`: 请求对象                 | 无                 |
| `registerFunction()`          | 注册一个函数以供 `function_call` 调用。                                                                  | `name`: 函数名称, `func`: 要注册的函数                                        | 无                 |
| `handleFunctionCallRequest()` | 处理 `function_call` 请求 (调用服务器端函数或转发给 SillyTavern)。                                       | `socket`: Socket.IO Socket 实例, `data`: 请求数据, `callback`: 回调函数       | `Promise<void>`    |
| `isValidKey()`                | 验证客户端密钥 (如果是 SillyTavern，则验证其存储的密钥；如果是普通客户端，则使用 `Keys.js` 验证)。       | `clientId`: 客户端 ID, `key`: 客户端提供的密钥                                | `Promise<boolean>` |
| `canSendMessage()`            | 检查发送者是否有权限向目标房间/客户端发送消息 (服务器、SillyTavern 或在同一房间内的客户端可以发送消息)。 | `senderClientId`: 发送者客户端 ID, `targetRoom`: 目标房间/客户端的 `clientId` | `boolean`          |

### 房间管理 (Rooms.js)

该模块提供了基于 Socket.IO 的房间管理功能。它允许创建、删除房间，以及将客户端添加到房间或从房间移除。

**重要提示：**  `Rooms.js` 现在完全依赖于 Socket.IO 的内置房间管理功能。 不再使用外部文件 (如 `settings.json`) 来存储房间信息。

| 函数名                                        | 描述                                                        | 参数                                                                           | 返回值     |
| :-------------------------------------------- | :---------------------------------------------------------- | :----------------------------------------------------------------------------- | :--------- |
| `createRoom(socket, roomName)`                | 创建一个新房间，并将创建者 `socket` 加入该房间。            | `socket`: 创建房间的客户端的 Socket.IO `socket` 对象, `roomName`: 房间名称     | `boolean`  |
| `deleteRoom(socket, roomName)`                | 删除一个房间。只有创建房间的 SillyTavern 扩展才能删除房间。 | `socket`: 发起删除操作的客户端的 Socket.IO `socket` 对象, `roomName`: 房间名称 | `boolean`  |
| `addClientToRoom(socket, roomName)`           | 将客户端添加到房间。                                        | `socket`: 要加入房间的客户端的 Socket.IO `socket` 对象,  `roomName`: 房间名称  | `boolean`  |
| `removeClientFromRoom(socket, roomName)`      | 将客户端从房间移除。                                        | `socket`: 要离开房间的客户端的 Socket.IO `socket` 对象, `roomName`: 房间名称   | `boolean`  |
| `isClientInRoom(clientId, roomName)`          | 检查客户端是否在房间内。                                    | `clientId`: 要检查的客户端 ID,`roomName`: 要检查的房间名称                     | `boolean`  |
| `getAllRooms()`                               | 获取服务器上的所有房间。                                    | 无                                                                             | `string[]` |
| `getClientRooms(socket)`                      | 获取客户端所在的房间列表。                                  | `socket`: 客户端的 Socket.IO `socket` 对象                                     | `string[]` |
| `setClientDescription(clientId, description)` | *已弃用*。设置客户端的描述信息 (不再使用)。                 | `clientId`: 客户端 ID, `description`: 描述                                     | 无         |
| `getClientDescription(clientId)`              | *已弃用*。获取客户端的描述信息 (不再使用)。                 | `clientId`: 客户端 ID                                                          | `string`   |

### 密钥管理 (Keys.js)

| 函数名                                | 描述                                  | 参数                                       | 返回值             |
| :------------------------------------ | :------------------------------------ | :----------------------------------------- | :----------------- |
| `generateAndStoreClientKey(clientId)` | 为客户端生成并存储密钥 (哈希后存储)。 | `clientId`: 客户端 ID                      | `Promise<string>`  |
| `removeClientKey(clientId)`           | 移除客户端密钥。                      | `clientId`: 客户端 ID                      | 无                 |
| `isValidClientKey(clientId, key)`     | 验证客户端密钥是否有效。              | `clientId`: 客户端 ID, `key`: 要验证的密钥 | `Promise<boolean>` |
| `getClientKey(clientId)`              | 获取客户端的密钥 (如果存在)。         | `clientId`: 客户端 ID                      | `string` \| `null` |
| `getAllClientKeys()`                  | 获取所有客户端密钥信息                | 无                                         | `object`           |

### 函数调用 (function_call.js)

| 函数名             | 描述                 | 参数                                                 | 返回值                                          |
| :----------------- | :------------------- | :--------------------------------------------------- | :---------------------------------------------- |
| `saveJsonToFile`   | 保存 JSON 数据到文件 | `filePath`: 文件路径, `jsonData`: 要保存的 JSON 数据 | `Promise<{ success: boolean, error?: string }>` |
| `readJsonFromFile` | 读取JSON文件         | `filePath`: 文件路径                                 | `Promise<any>`                                  |

### 非流式消息处理 (non_stream.js)

| 函数名                         | 描述                                              | 参数                                                                                       | 返回值 |
| :----------------------------- | :------------------------------------------------ | :----------------------------------------------------------------------------------------- | :----: |
| `sendNonStreamMessage`         | 发送非流式消息                                    | `socket`: Socket, `message`: 消息, `requestId`: 请求 ID (可选), `outputId`: 输出 ID (可选) |   无   |
| `setupServerNonStreamHandlers` | 设置服务器端非流式消息处理器 (在 `/llm` 命名空间) | `io`: Socket.IO Server 实例, `namespace`: 命名空间, `llmRequests`: 请求映射对象            |   无   |

### 流式消息处理 (stream.js)

| 函数名                      | 描述                                                                                                      | 参数                                                                                                       | 返回值              |
| :-------------------------- | :-------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- | :------------------ |
| `setupServerStreamHandlers` | 设置服务器端流式消息处理器 (在 `/llm` 命名空间)                                                           | `io`: Socket.IO Server 实例, `namespace`: 命名空间, `llmRequests`: 请求映射对象                            | 无                  |
| `forwardStreamData`         | 返回一个流式数据转发处理函数 (使用 `socket.io-stream`)，该函数在 `setupServerStreamHandlers` 内部被调用。 | `io`: Socket.IO Server 实例, `namespace`: 命名空间,  `llmRequests`: 请求映射对象, `originalData`: 原始数据 | `forwardingHandler` |

## 命名空间 (NAMESPACES)

服务器使用 Socket.IO 的命名空间来组织不同的功能和消息类型：

- **`/` (默认命名空间):**  用于处理基本的连接、断开连接和监控客户端。
- **`/auth`:**  用于客户端认证 (密钥验证、临时房间分配) 和 SillyTavern 扩展的识别。
- **`/clients`:**  用于管理客户端密钥 (生成、移除、获取列表等)，主要供 SillyTavern 扩展使用。
- **`/llm`:**  **核心命名空间**，用于处理所有 LLM 相关的请求和响应 (包括流式和非流式)。
- **`/sillytavern`:**  用于 SillyTavern 扩展与服务器之间的特定通信 (例如，客户端设置同步)。
- **`/function_call`:** 用于处理函数调用请求。

## 消息类型 (MSG_TYPE)

`MSG_TYPE` (定义在 `lib/constants.js` 中) 是一个常量对象，定义了服务器和客户端之间使用的所有消息类型：

```javascript
const MSG_TYPE = {
  NON_STREAM: 0,
  STREAM_START: 1,
  STREAM_DATA: 2,       // (Deprecated)
  STREAM_END: 3,        // (Deprecated)
  STREAM_DATA_FIRST: 4,
  STREAM_DATA_MIDDLE: 5,
  STREAM_DATA_LAST: 6,
  STREAM_DATA_RETRY: 7,
  STREAM_DATA_FAILED: 8,
  LLM_REQUEST: 9,
  LLM_RESPONSE: 10,    // (不再直接使用，LLM 响应现在通过流式或非流式消息发送)
  IDENTIFY_SILLYTAVERN: 11,
  CLIENT_SETTINGS: 12,
  CREATE_ROOM: 13,
  DELETE_ROOM: 14,
  ADD_CLIENT_TO_ROOM: 15,
  REMOVE_CLIENT_FROM_ROOM: 16,
  GENERATE_CLIENT_KEY: 17,
  REMOVE_CLIENT_KEY: 18,
  GET_ROOMS: 19,
  CLIENT_KEY: 20,           // (Deprecated)
  ERROR: 21,
  FUNCTION_CALL: 22,
  LOGIN: 23,
  GET_CLIENT_LIST: 24,
  GET_CLIENTS_IN_ROOM: 25,
  GET_CLIENT_KEY: 26, //新增: SillyTavern -> 服务器：获取客户端密钥
};
```

## 事件

- **服务器 -> 客户端:**

    | 事件名           | 命名空间        | 描述                                     | 数据格式                                                                                                                      |
    | :--------------- | :-------------- | :--------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
    | `message`        | `/llm`          | 通用消息事件 (用于非流式 LLM 响应)。     | `{ type: MSG_TYPE.NON_STREAM, data: any, source: 'server', requestId: string, outputId: string }`                             |
    | `streamed_data`  | `/llm`          | 流式数据事件 (使用 `socket.io-stream`)。 | `stream`:  `socket.io-stream` 的可读流, `data`: `{ streamId: string, outputId: string, requestId: string, source: 'server' }` |
    | `MSG_TYPE.ERROR` | `/auth`, `/llm` | 错误消息。                               | `{ type: MSG_TYPE.ERROR, message: string, requestId?: string }`                                                               |

- **SillyTavern -> 服务器:**

    | 事件名                             | 命名空间         | 描述                       | 数据格式                                                                    |
    | :--------------------------------- | :--------------- | :------------------------- | :-------------------------------------------------------------------------- |
    | `message`                          | `/llm`           | 通用消息事件               | 根据具体消息类型而定                                                        |
    | `STREAM_EVENTS.START` 等           | `/llm`           | 流式消息事件               | 见 `stream.js`                                                              |
    | `MSG_TYPE.IDENTIFY_SILLYTAVERN`    | `/auth`          | SillyTavern 扩展认证       | `{ clientId: string }`                                                      |
    | `MSG_TYPE.CLIENT_SETTINGS`         | `/sillytavern`   | 发送客户端设置             | `object` (客户端设置)                                                       |
    | `MSG_TYPE.LLM_REQUEST`             | `/llm`           | 发送 LLM 请求              | `{ requestId: string, message: string, target: string, isStream: boolean }` |
    | `MSG_TYPE.CREATE_ROOM`             | `/auth`          | 创建房间                   | `{ roomName: string }`                                                      |
    | `MSG_TYPE.DELETE_ROOM`             | `/auth`          | 删除房间                   | `{ roomName: string }`                                                      |
    | `MSG_TYPE.ADD_CLIENT_TO_ROOM`      | `/auth`          | 将客户端添加到房间         | `{ clientId: string, roomName: string }`                                    |
    | `MSG_TYPE.REMOVE_CLIENT_FROM_ROOM` | `/auth`          | 将客户端从房间移除         | `{ clientId: string, roomName: string }`                                    |
    | `MSG_TYPE.GENERATE_CLIENT_KEY`     | `/clients`       | 生成客户端密钥             | `{ clientId: string }`                                                      |
    | `MSG_TYPE.REMOVE_CLIENT_KEY`       | `/clients`       | 移除客户端密钥             | `{ clientId: string }`                                                      |
    | `MSG_TYPE.GET_ROOMS`               | `/auth`          | 获取房间列表               | 无                                                                          |
    | `MSG_TYPE.FUNCTION_CALL`           | `/function_call` | 调用函数                   | `{ requestId: string, functionName: string, args: any[], target: string }`  |
    | `MSG_TYPE.LOGIN`                   | `/auth`          | 客户端登录验证             | `{ clientId: string, password: string }`                                    |
    | `getClientList`                    | `/clients`       | 获取客户端列表             | 无                                                                          |
    | `getClientsInRoom`                 | `/clients`       | 获取指定房间内的客户端列表 | `{ roomName: string }`                                                      |
    | `MSG_TYPE.GET_CLIENT_KEY`          | `/clients`       | 获取客户端密钥             | `{ clientId: string }`                                                      |
    | `disconnect`                       | 所有             | 客户端断开连接             | `reason`: 断开连接的原因                                                    |

## 数据结构

- **`serverSettings` (Object):** 服务器配置 (从 `settings/server_settings.json` 加载)。
- **`trustedSillyTaverns` (Set):** 可信的 SillyTavern 实例的 `clientId` 集合。
- **`trustedClients` (Set):** 可信的普通客户端的 `clientId` 集合。
- **`llmRequests` (Object):** LLM 请求的映射关系：`{ [requestId]: [ { target: string, clientId: string }, ... ] }`。
- **`streamBuffers` (Object):** `{ [streamId]: { [chunkIndex]: data } }`，用于存储和重组来自 SillyTavern 的流式数据块。
- **`outputBuffers` (Object):** `{ [outputId]: messageString }`，用于存储构建的消息 (主要用于记录)。
- **`requestStatus` (Object):** `{ [requestId]: 'started' | 'processing' | 'completed' }`，用于跟踪流式请求的状态。
- **`clientStreams` (Object):** `{ [streamId]: stream }`，用于存储每个流 ID 对应的 `socket.io-stream` 流 (服务器 -> 客户端转发)。
- **`functionRegistry` (Object):** `{ [functionName]: function }`，存储服务器端可调用的函数。
- **`reconnectIntervals` (Object):** `{ [clientId]: intervalId }`，存储客户端的重连间隔 ID。
- **`tempRooms` (Object):** `{ [clientId]: tempRoomId }`，存储临时房间的映射关系。

## 开发指南

1. **消息格式**：客户端和服务器之间的所有消息都应该遵循以下基本格式：

    ```json
    {
      "type": "消息类型 (参考 MSG_TYPE)",
      "requestId": "唯一请求 ID (UUID)",
      "clientId": "唯一客户端ID",
      "source": "消息来源 ('server' 或 客户端 ID)",
      "target": "目标('server' 或者 客户端 ID)",
      "...": "其他数据 (根据消息类型而定)"
    }
    ```

2. **流式消息 (SillyTavern -> 服务器 -> 客户端):**

    - **SillyTavern -> 服务器：**  使用 `STREAM_EVENTS` 中的事件名称 (`STREAM_START`, `DATA_FIRST`, `DATA_MIDDLE`, `DATA_LAST`, `STREAM_END`) 发送流式消息。 服务器使用 `streamBuffers` 和 `outputBuffers` 接收和重组数据块。
    - **服务器 -> 客户端：**  服务器使用 `socket.io-stream` 将数据 *即时* 转发给客户端 (在 `handleStreamData` 中调用 `clientStreams[data.streamId].write(data.data)`)。 客户端监听 `'streamed_data'` 事件，接收 `socket.io-stream` 流和元数据。

3. **非流式消息：**

    - 使用 `sendNonStreamMessage` 函数 (在 `lib/non_stream.js` 中) 发送非流式消息。
    - 服务器在 `/llm` 命名空间中监听 `'message'` 事件来接收非流式消息。

4. **LLM 请求/响应：**
    - 客户端在发送 `LLM_REQUEST` 时，必须在 `data` 中包含 `target` (目标 SillyTavern 的 `clientId`)、`requestId` 和 `isStream` (是否是流式请求) 字段。
    - 服务器通过 `llmRequests` 对象跟踪请求和响应的映射关系，以便将响应转发回正确的客户端。

5. **房间管理**：使用 `Rooms.js` 中的函数来管理房间。

6. **密钥管理**：使用 `Keys.js` 中的函数来生成、存储和验证密钥。

7. **函数调用**：
    - 服务器端：使用 `registerFunction()` 函数注册可供调用的函数。
    - 客户端：使用 `MSG_TYPE.FUNCTION_CALL` 消息类型发送函数调用请求，并在 `data` 中包含 `functionName`、`args` 和 `target` 字段。

8. **错误处理**：
    - 在事件监听器中，使用 `try...catch` 块来捕获错误。
    - 向客户端发送错误消息时，使用 `MSG_TYPE.ERROR` 类型。

9. **异步操作**：注意 `async/await` 和 `Promise` 的使用。

## 注意事项

- 服务器需要 `settings/` 目录来存储 `server_settings.json` 和客户端配置文件。
- SillyTavern 扩展的 `clientId` 应该以 "SillyTavern" 开头 (这是一个约定，可以在 `loadServerSettings` 中修改)。
- 遵循最小权限原则，只授予客户端和扩展必要的权限。
- 注意服务器的资源消耗，避免内存泄漏和性能问题。
