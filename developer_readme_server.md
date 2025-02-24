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
│   ├── Keys.js            (密钥管理)
│   └── Passwords.js       (密码管理 - 可选)
├── lib/
│   ├── constants.js      (常量定义)
│   ├── non_stream.js    (非流式消息处理)
│   ├── stream.js        (流式消息处理)
│   └── uuid.js          (UUID 生成)
├── node_modules/
├── settings.json        (服务器设置)
├── clients.json         (客户端密钥)
├── passwords.json       (可选：如果使用独立文件存储密码)
├── package.json
└── server.js            (服务器主入口)
```

## 初始化流程

1.  **加载模块**: 导入必要的 Node.js 模块和自定义模块。
2.  **创建 Express 应用和 HTTP 服务器**: 使用 `express` 和 `http` 模块创建服务器。
3.  **创建 Socket.IO 服务器**: 创建 Socket.IO 服务器实例，并配置 CORS。
4.  **加载服务器设置**: 从 `settings.json` 文件加载服务器设置，如果文件不存在则创建。
5.  **定义全局变量**: 定义请求队列、SillyTavern 扩展的 socket ID、连接状态等变量。
6.  **注册 `function_call` 函数**: 遍历 `function_call.js` 中导出的函数，并使用 `registerFunction()` 注册到 `functionRegistry`。
7.  **启动 HTTP 服务器**: 调用 `httpServer.listen()` 启动服务器。

## 模块和函数

### 主服务器逻辑 (server.js)

| 函数名                        | 描述                                          | 参数                                                                    | 返回值             |
| :---------------------------- | :-------------------------------------------- | :---------------------------------------------------------------------- | :----------------- |
| `loadServerSettings()`        | 从 `settings.json` 文件加载服务器设置。       | 无                                                                      | 无                 |
| `saveServerSettings()`        | 将服务器设置保存到 `settings.json` 文件。     | `newSettings`: 要保存的新设置                                           | 无                 |
| `reinitializeSocketIO()`      | 重新初始化 Socket.IO 服务器（应用新的设置）。 | `newSettings`: 新的服务器设置                                           | 无                 |
| `processLLMRequest()`         | 处理 LLM 请求队列。                           | 无                                                                      | 无                 |
| `registerFunction()`          | 注册一个函数以供 `function_call` 调用。       | `name`: 函数名称, `func`: 要注册的函数                                  | 无                 |
| `handleFunctionCallRequest()` | 处理 `function_call` 请求。                   | `socket`: Socket.IO Socket 实例, `data`: 请求数据, `callback`: 回调函数 | 无                 |
| `isValidKey()`                | 验证客户端密钥。                              | `clientId`: 客户端 ID, `key`: 客户端提供的密钥                          | `Promise<boolean>` |
| `canSendMessage()`            | 检查发送者是否有权限向目标房间发送消息。      | `senderClientId`: 发送者客户端 ID, `targetRoom`: 目标房间名称           | `boolean`          |
| `io.on('connection', ...)`    | 处理新的 Socket.IO 连接。                     | `socket`: Socket.IO Socket 实例                                         | 无                 |

**Socket.IO 事件监听 (在 `io.on('connection', ...)` 内)**

| 事件名                             | 描述                                          | 数据格式                                                                   |
| :--------------------------------- | :-------------------------------------------- | :------------------------------------------------------------------------- |
| `MSG_TYPE.IDENTIFY_SILLYTAVERN`    | 接收 SillyTavern 扩展的主密钥。               | `{ key: string }`                                                          |
| `MSG_TYPE.CLIENT_SETTINGS`         | 接收客户端设置。                              | `object` (客户端设置)                                                      |
| `MSG_TYPE.LLM_REQUEST`             | 接收 LLM 请求。                               | `{ clientId: string, requestId: string, message: string, target: string }` |
| `MSG_TYPE.LLM_RESPONSE`            | 接收 LLM 响应。                               | `{ requestId: string, message: string, target: string }`                   |
| `MSG_TYPE.CREATE_ROOM`             | 创建房间（仅限 SillyTavern 扩展）。           | `{ roomName: string }`                                                     |
| `MSG_TYPE.DELETE_ROOM`             | 删除房间（仅限 SillyTavern 扩展）。           | `{ roomName: string }`                                                     |
| `MSG_TYPE.ADD_CLIENT_TO_ROOM`      | 将客户端添加到房间（仅限 SillyTavern 扩展）。 | `{ clientId: string, roomName: string }`                                   |
| `MSG_TYPE.REMOVE_CLIENT_FROM_ROOM` | 将客户端从房间移除。                          | `{ clientId: string, roomName: string }`                                   |
| `MSG_TYPE.GENERATE_CLIENT_KEY`     | 生成客户端密钥（仅限 SillyTavern 扩展）。     | `{ clientId: string }`                                                     |
| `MSG_TYPE.REMOVE_CLIENT_KEY`       | 移除客户端密钥（仅限 SillyTavern 扩展）。     | `{ clientId: string }`                                                     |
| `MSG_TYPE.GET_ROOMS`               | 获取房间列表（仅限 SillyTavern 扩展）。       | 无                                                                         |
| `MSG_TYPE.LOGIN`                   | 客户端登录验证                                | `{ password: string }`                                                     |
| `getClientList`                    | 获取客户端列表（仅限 SillyTavern 扩展）。     | 无                                                                         |
| `getClientsInRoom`                 | 获取指定房间内的客户端列表。                  | `{ roomName: string }`                                                     |
| `disconnect`                       | 处理客户端断开连接事件。                      | `reason`: 断开连接的原因                                                   |
| `message`                          | 接收客户端消息                                | 根据具体消息类型而定                                                       |
| `STREAM_EVENTS`                    | 处理流式消息                                  | 具体格式见 `stream.js`                                                     |

### 房间管理 (Rooms.js)

| 函数名                                             | 描述                         | 参数                                                                                      | 返回值             |
| :------------------------------------------------- | :--------------------------- | :---------------------------------------------------------------------------------------- | :----------------- |
| `createRoom(extensionId, roomName)`                | 创建一个新房间。             | `extensionId`: 创建房间的扩展 ID, `roomName`: 要创建的房间名称                            | `Promise<boolean>` |
| `deleteRoom(extensionId, roomName)`                | 删除一个房间。               | `extensionId`: 删除房间的扩展 ID, `roomName`: 要删除的房间名称                            | `Promise<boolean>` |
| `addClientToRoom(extensionId, clientId, roomName)` | 将一个客户端添加到一个房间。 | `extensionId`: 执行操作的扩展 ID, `clientId`: 要添加的客户端 ID, `roomName`: 目标房间名称 | `Promise<boolean>` |
| `removeClientFromRoom(clientId, roomName)`         | 将一个客户端从一个房间移除。 | `clientId`: 要移除的客户端 ID, `roomName`: 要移除的房间名称                               | `Promise<boolean>` |
| `getExtensionRooms(extensionId)`                   | 获取指定扩展创建的所有房间。 | `extensionId`: 扩展 ID                                                                    | `string[]`         |
| `getAllRooms`                                      | 获取服务器所有房间           | 无                                                                                        | `string[]`         |
| `setClientDescription(clientId, description)`      | 设置客户端的描述信息。       | `clientId`: 客户端 ID, `description`: 客户端描述                                          | 无                 |
| `getClientDescription(clientId)`                   | 获取客户端的描述信息。       | `clientId`: 客户端 ID                                                                     | `string` \| `null` |

### 密钥管理 (Keys.js)

| 函数名                                | 描述                                   | 参数                                       | 返回值             |
| :------------------------------------ | :------------------------------------- | :----------------------------------------- | :----------------- |
| `generateAndStoreClientKey(clientId)` | 为客户端生成并存储密钥（哈希后存储）。 | `clientId`: 客户端 ID                      | `Promise<string>`  |
| `removeClientKey(clientId)`           | 移除客户端密钥。                       | `clientId`: 客户端 ID                      | 无                 |
| `isValidClientKey(clientId, key)`     | 验证客户端密钥是否有效。               | `clientId`: 客户端 ID, `key`: 要验证的密钥 | `Promise<boolean>` |
| `getClientRooms(clientId)`            | 获取客户端所属的房间列表。             | `clientId`: 客户端 ID                      | `string[]`         |
| `setClientRooms`                      | 设置客户端房间列表                     | `clientId`: 客户端 ID, `rooms`: 房间列表   | 无                 |
| `getAllClientKeys()`                  | 获取所有客户端的密钥信息。             | 无                                         | `object`           |
| `getClientKey`                        | 获取客户端密钥                         | `clientId`: 客户端 ID                      | `string` / `null`  |

### 函数调用 (function_call.js)

| 函数名             | 描述                 | 参数                                                 | 返回值                                          |
| :----------------- | :------------------- | :--------------------------------------------------- | :---------------------------------------------- |
| `saveJsonToFile`   | 保存 JSON 数据到文件 | `filePath`: 文件路径, `jsonData`: 要保存的 JSON 数据 | `Promise<{ success: boolean, error?: string }>` |
| `readJsonFromFile` | 读取JSON文件         | `filePath`: 文件路径                                 | `Promise<any>`                                  |

### 非流式消息处理 (non_stream.js)
|             函数名             |             描述             |                                                           参数                                                            | 返回值 |
| :----------------------------: | :--------------------------: | :-----------------------------------------------------------------------------------------------------------------------: | :----: |
|     `sendNonStreamMessage`     |        发送非流式消息        | `socket`: Socket, `message`: 消息内容, `requestId`: 请求 ID (可选), `outputId`: 输出 ID (可选), `extensionName`: 扩展名称 |   无   |
| `setupServerNonStreamHandlers` | 设置服务器端非流式消息处理器 |                                    `io`: Socket.IO Server 实例, `namespace`: 命名空间                                     |   无   |

### 流式消息处理 (stream.js)
|           函数名            |            描述            |                                                参数                                                |    返回值    |
| :-------------------------: | :------------------------: | :------------------------------------------------------------------------------------------------: | :----------: |
| `setupServerStreamHandlers` | 设置服务器端流式消息处理器 | `io`: Socket.IO Server 实例, `namespace`: 命名空间, `forwardingHandler`: 自定义转发处理函数 (可选) |      无      |
|     `forwardStreamData`     |        流式转发数据        |        `io`: Socket.IO Server 实例, `namespace`: 命名空间, `targetRoom`: 目标房间名 (可选)         | 转发处理函数 |

## 消息类型 (MSG_TYPE)

`MSG_TYPE` 是一个常量对象，定义了服务器和客户端之间使用的所有消息类型。

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
    LLM_RESPONSE: 10,
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
};
```

## 事件
*  服务器向客户端的事件

| 事件名                            | 描述          | 数据格式                                                                   |
| :-------------------------------- | :------------ | :------------------------------------------------------------------------- |
| `message`                         | 通用消息事件  | 根据具体消息类型而定                                                       |
| `STREAM_EVENTS.START_RESPONSE` 等 | 流式消息事件  | 见 `stream.js`                                                             |
| `MSG_TYPE.LLM_REQUEST`            | 发送LLM请求   | `{ clientId: string, requestId: string, message: string, target: string }` |
| `MSG_TYPE.LLM_RESPONSE`           | 发送 LLM 响应 | `{ requestId: string, message: string, target: string }`                   |
| `MSG_TYPE.ERROR`                  | 错误信息      | `{type: number,message: string,error: string,requestId: string,}`          |

* 客户端向服务器的事件
  
| 事件名                             | 描述                       | 数据格式                                                                   |
| :--------------------------------- | :------------------------- | :------------------------------------------------------------------------- |
| `message`                          | 通用消息事件               | 根据具体消息类型而定                                                       |
| `STREAM_EVENTS.START` 等           | 流式消息事件               | 见 `stream.js`                                                             |
| `MSG_TYPE.IDENTIFY_SILLYTAVERN`    | SillyTavern 扩展认证       | `{ key: string }`                                                          |
| `MSG_TYPE.CLIENT_SETTINGS`         | 发送客户端设置             | `object` (客户端设置)                                                      |
| `MSG_TYPE.LLM_REQUEST`             | 发送 LLM 请求              | `{ clientId: string, requestId: string, message: string, target: string }` |
| `MSG_TYPE.LLM_RESPONSE`            | 发送 LLM 响应              | `{ requestId: string, message: string, target: string }`                   |
| `MSG_TYPE.CREATE_ROOM`             | 创建房间                   | `{ roomName: string }`                                                     |
| `MSG_TYPE.DELETE_ROOM`             | 删除房间                   | `{ roomName: string }`                                                     |
| `MSG_TYPE.ADD_CLIENT_TO_ROOM`      | 将客户端添加到房间         | `{ clientId: string, roomName: string }`                                   |
| `MSG_TYPE.REMOVE_CLIENT_FROM_ROOM` | 将客户端从房间移除         | `{ clientId: string, roomName: string }`                                   |
| `MSG_TYPE.GENERATE_CLIENT_KEY`     | 生成客户端密钥             | `{ clientId: string }`                                                     |
| `MSG_TYPE.REMOVE_CLIENT_KEY`       | 移除客户端密钥             | `{ clientId: string }`                                                     |
| `MSG_TYPE.GET_ROOMS`               | 获取房间列表               | 无                                                                         |
| `MSG_TYPE.FUNCTION_CALL`           | 调用函数                   | `{ requestId: string, functionName: string, args: any[], target: string }` |
| `MSG_TYPE.LOGIN`                   | 客户端登录验证             | `{ password: string }`                                                     |
| `getClientList`                    | 获取客户端列表             | 无                                                                         |
| `getClientsInRoom`                 | 获取指定房间内的客户端列表 | `{ roomName: string }`                                                     |
| `disconnect`                       | 客户端断开连接             | `reason`: 断开连接的原因                                                   |

## 数据结构
* `serverSettings`:
```javascript
reconnectAttempts: 3, // 重试次数
reconnectDelay: 1000, // 重试间隔 (毫秒)
timeout: 5000,
autoConnect: true,
socketIOPath: '/socket.io',
queryParameters: {},
transport: 'websocket',
sillyTavernMasterKey: null, //SillyTavern扩展的主密钥, 已哈希
```
* `clients.json`:
```json
{
    "客户端id1":{
        "key":"密钥的hash值",
        "rooms":["房间1", "房间2"],
        "description": "客户端的描述"
    },
    "客户端id2":{
        "key":"密钥hash",
        "rooms":["房间1"],
        "description": "客户端的描述"
    }
}
```

## 开发指南

1.  **消息格式**: 客户端和服务器之间的所有消息都应该遵循以下基本格式：

    ```json
    {
        "type": "消息类型 (参考 MSG_TYPE)",
        "requestId": "唯一请求 ID (UUID)",
        "target": "消息目标 ('server' 或 客户端 ID/房间名)",
        "source": "消息来源 (客户端 ID 或 'server')",
        "...": "其他数据 (根据消息类型而定)",
    }
    ```

2.  **流式消息**: 使用 `STREAM_EVENTS` 中的事件名称来发送和接收流式消息。

3.  **房间管理**: 使用 `Rooms.js` 中的函数来管理房间。

4.  **密钥管理**: 使用 `Keys.js` 中的函数来生成、存储和验证密钥。

5.  **函数调用**:
    *   服务器端：使用 `registerFunction()` 函数注册可供调用的函数。
    *   客户端：使用 `MSG_TYPE.FUNCTION_CALL` 消息类型发送函数调用请求，并在 `data` 中包含 `functionName`、`args` 和 `target` 字段。

6.  **错误处理**:
    *   在 `socket.on` 监听器中，使用 `try...catch` 块来捕获错误。
    *   向客户端发送错误消息时，使用 `MSG_TYPE.ERROR` 类型，并在 `message` 字段中包含错误描述。

7. **异步操作**:
    *   注意 `async/await` 和 `Promise` 的使用。
    *   确保在异步操作完成后再处理下一个请求。

## 注意事项
* 服务器需要一个`settings.json`文件以存储设置。
* 客户端密钥存储在`clients.json`中。
* 密码存储在`passwords.json`中（可选）。
* 确保所有与服务器的通信都使用 HTTPS。
* 遵循最小权限原则，只授予客户端和扩展必要的权限。
* 定期审查和更新代码，修复安全漏洞。
* 注意服务器的资源消耗，避免内存泄漏和性能问题。
* 在开发过程中，使用日志记录来帮助调试和排查问题。

希望这份开发文档能够帮助你更好地理解和使用 SillyTavern-NewAge 扩展的服务器端代码！
