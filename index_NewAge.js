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
import { createRoom, deleteRoom, addClientToRoom, removeClientFromRoom, getRooms } from './dist/Rooms.js';

const extensionName = 'SillyTavern-NewAge';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

let socket = null;
let streamBuffer = [];
let isStreaming = false;
let logCounter = 0;

// 新增：请求队列
const llmRequestQueue = [];
const functionCallQueue = [];
let isProcessingRequest = false; // 标志：是否有请求正在处理中

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
    $('#socketio-connectBtn').prop('disabled', isConnected);
    $('#socketio-disconnectBtn').prop('disabled', !isConnected);
}

/**
 * @description 更新客户端列表 / Updates the client list.
 * @function updateClientList
 * @param {Array} [clients] - 客户端列表 / List of clients.
 * @returns {void}
 */
function updateClientList(clients) {
    const clientListSelect = $('#socketio-clientList');
    clientListSelect.empty(); // 清空现有选项 / Clear existing options
    clientListSelect.append($('<option>', { value: '', text: '-- Select Client --' }));
    if (clients) {
        clients.forEach(client => {
            clientListSelect.append(
                $('<option>', {
                    value: client.id, // 使用客户端 ID 作为 value / Use client ID as value
                    text: client.id, // 显示客户端 ID / Display client ID
                }),
            );
        });
    }
}

/**
 * @description 获取 SillyTavern 实例的端口号 / Gets the port number of the SillyTavern instance.
 * @function getSillyTavernPort
 * @returns {string} SillyTavern 实例的端口号 / The port number of the SillyTavern instance.
 */
function getSillyTavernPort() {
    //SillyTavern的端口储存在这里
    return $('#server_port').val();
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
    const fullServerAddress = `${serverAddress}:${serverPort}`;

    clientId = generateClientId(); // 生成客户端 ID
    const clientDesc = `本客户端是扩展端，运行于 ${getSillyTavernPort()} 端口`; // 设置客户端描述

    socket = io(fullServerAddress + NAMESPACES.GENERAL, {
        auth: {
            clientType: 'extension',
            clientId: clientId,
            desc: clientDesc,
            // key:  // 密钥稍后设置
        }
    });
    globalThis.socket = socket;


    // 先监听连接建立事件，再发送主密钥
    socket.on('connect', async () => {
        addLogMessage('success', '已连接到服务器', 'client');
        updateButtonState(true);
        $('#socketio-testBtn').prop('disabled', false);
        console.log('Socket.IO: Connected');
        toastr.success('Socket.IO: 已连接', 'Socket.IO');

        // 获取或生成客户端密钥
        const key = await getOrCreateClientKey();
        // 设置 auth 数据 (如果还没有)
        socket.auth = {
            clientType: 'extension',
            clientId: clientId,
            key: key,
            desc: clientDesc,
        };

        // 连接成功后，发送主密钥 (如果存在)
        sendMasterKey();
        refreshRoomList();
        updateClientList();
    });

    setupSocketListeners(); // 设置其他 Socket.IO 事件监听器
}

/**
 * @description 获取或生成客户端密钥 / Gets or generates a client key.
 * @async
 * @function getOrCreateClientKey
 * @returns {Promise<string>} 客户端密钥 / The client key.
 */
async function getOrCreateClientKey() {
    return new Promise((resolve) => {
        // 尝试从服务器获取密钥
        socket.emit(MSG_TYPE.GET_CLIENT_KEY, { clientId }, (response) => {
            if (response.status === 'ok' && response.key) {
                // 服务器返回了密钥
                console.log("从服务器获取密钥")
                resolve(response.key);
            } else {
                // 服务器没有密钥，生成一个新的
                console.log("未找到密钥,正在生成")
                socket.emit(MSG_TYPE.GENERATE_CLIENT_KEY, { clientId }, (response) => {
                    if (response.status === 'ok' && response.key) {
                        console.log("生成密钥")
                        resolve(response.key);
                    } else {
                        console.error('Failed to generate client key:', response.message);
                        toastr.error('Failed to generate client key.', 'Error');
                        resolve(null); // 或者抛出错误
                    }
                });
            }
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
        socket.emit(MSG_TYPE.IDENTIFY_SILLYTAVERN, { key: serverSettings.sillyTavernMasterKey });
    }
}

/**
 * @description 设置 Socket.IO 事件监听器 / Sets up Socket.IO event listeners.
 * @function setupSocketListeners
 * @returns {void}
 */
function setupSocketListeners() {
    // 消息处理
    socket.on('message', data => {
        // data: { type: number, data: string, source: string, requestId: string, outputId: string }
        if (data.type === MSG_TYPE.NON_STREAM) {
            addLogMessage('info', `服务器: ${data.data}`, data.source, data.requestId, data.outputId);
            console.log('Socket.IO: Message received', data);

            if (data.data === 'Yes,connection is fine.') {
                toastr.success('连接活跃!', '测试连接');
            }
        }
    });

    // 流式传输事件
    socket.on(STREAM_EVENTS.START_RESPONSE, data => {
        // data: { type: number, streamId: string, outputId: string, numStreams: number, source: string, requestId: string }
        if (data.type === MSG_TYPE.STREAM_START) {
            streamBuffer = [];
            isStreaming = true;
            addLogMessage('info', '开始接收流...', data.source, data.requestId, data.outputId);
            console.log('Socket.IO: Stream started (response)', data);
        }
    });

    socket.on(STREAM_EVENTS.DATA_FIRST_RESPONSE, data => {
        // data: { type: number, streamId: string, outputId: string, chunkIndex: number, data: string, source: string, requestId: string }
        if (data.type === MSG_TYPE.STREAM_DATA_FIRST) {
            addLogMessage('info', `接收到流数据（首块）...`, data.source, data.requestId, data.outputId);
            console.log('Socket.IO: First chunk received (response)', data);
            streamBuffer.push(data.data);
        }
    });

    socket.on(STREAM_EVENTS.DATA_MIDDLE_RESPONSE, data => {
        // data: { type: number, streamId: string, outputId: string, chunkIndex: number, data: string, source: string, requestId: string }
        if (data.type === MSG_TYPE.STREAM_DATA_MIDDLE) {
            addLogMessage('info', `接收到流数据（中块）...`, data.source, data.requestId, data.outputId);
            console.log('Socket.IO: Middle chunk received (response)', data);
            streamBuffer.push(data.data);
        }
    });

    socket.on(STREAM_EVENTS.DATA_LAST_RESPONSE, data => {
        // data: { type: number, streamId: string, outputId: string, chunkIndex: number, data: string, source: string, requestId: string }
        if (data.type === MSG_TYPE.STREAM_DATA_LAST) {
            addLogMessage('info', `接收到流数据（末块）...`, data.source, data.requestId, data.outputId);
            console.log('Socket.IO: Last chunk received (response)', data);
            streamBuffer.push(data.data);
        }
    });

    socket.on(STREAM_EVENTS.DATA_RETRY_RESPONSE, data => {
        // data: { type: number, streamId: string, outputId: string, chunkIndex: number, data: string, source: string, requestId: string }
        if (data.type === MSG_TYPE.STREAM_DATA_RETRY) {
            addLogMessage('info', `接收到流数据（重试）...`, data.source, data.requestId, data.outputId);
            console.log('Socket.IO: Stream retry (response)', data);
            streamBuffer.push(data.data);
        }
    });

    socket.on(STREAM_EVENTS.DATA_FAILED_RESPONSE, data => {
        // data: { type: number, streamId: string, outputId: string, source: string, requestId: string, error: any }
        if (data.type === MSG_TYPE.STREAM_DATA_FAILED) {
            addLogMessage('fail', '流错误', data.source, data.requestId, data.outputId);
            console.log('Socket.IO: Stream error (response)', data);
            isStreaming = false;
        }
    });
    // 为了打印完整消息用
    let lastToastrOutputId = null;
    socket.on(STREAM_EVENTS.END_RESPONSE, data => {
        // data: { type: number, streamId: string, outputId: string, source: string, requestId: string }
        if (data.type === MSG_TYPE.STREAM_END) {
            if (isStreaming) {
                isStreaming = false;
                const fullMessage = streamBuffer.join('');
                addLogMessage('success', `流内容: ${fullMessage}`, data.source, data.requestId, data.outputId);
                console.log('Socket.IO: Stream ended, Content:', fullMessage);

                if (data.outputId !== lastToastrOutputId) {
                    lastToastrOutputId = data.outputId;
                }

                streamBuffer = [];
            }
        }
    });

    // LLM 请求/响应
    socket.on(MSG_TYPE.LLM_REQUEST, handleLlmRequest);
    // data: { clientId: string, requestId: string, message: string, target: string }

    socket.on(MSG_TYPE.LLM_RESPONSE, data => {
        // data: { requestId: string, message: string, target: string }
        addLogMessage('info', `Received LLM response: ${data.message}`, 'server', data.requestId);
        console.log('Received LLM response:', data);
    });

    socket.on(MSG_TYPE.FUNCTION_CALL, (data, callback) => {
      // 检查 target 是否为当前扩展的 clientId
      if (data.target === clientId) {
        handleFunctionCallFromClient(data, callback);
      }
    });

    // 连接/断开连接/错误
    socket.on('disconnect', reason => {
        addLogMessage('warning', `与服务器断开连接: ${reason}`, 'client');
        updateButtonState(false);
        $('#socketio-testBtn').prop('disabled', true);
        socket = null;
        globalThis.socket = null;
        console.log('Socket.IO: Disconnected');
        toastr.warning(`已断开连接: ${reason}`, 'Socket.IO');
    });

    socket.on('connect_error', error => {
        addLogMessage('fail', `连接错误: ${error}`, 'client');
        updateButtonState(false);
        console.error('Socket.IO: Connection error', error);
        toastr.error(`连接错误: ${error}`, 'Socket.IO');
    });

    socket.on('reconnect_failed', () => {
        addLogMessage('fail', '重连失败', 'client');
        updateButtonState(false);
        console.error('Socket.IO: Reconnect failed');
        toastr.error('重连失败', 'Socket.IO');
    });
}

/**
 * @description 断开与 Socket.IO 服务器的连接 / Disconnects from the Socket.IO server.
 * @function onDisconnectClick
 * @returns {void}
 */
function onDisconnectClick() {
    if (socket) {
        socket.disconnect();
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
    messageForwarder.handleStreamToken(data, messageForwarder.getMessageType());
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
        return; // 如果有请求正在处理，则直接返回
    }

    if (llmRequestQueue.length > 0) {
        isProcessingRequest = true;
        const request = llmRequestQueue.shift();
        try {
            // 调用 iframeGenerate 生成文本
            const generatedText = await iframeGenerate(request.generateConfig);
            // 在这里处理生成结果，例如发送给服务器
            if (!globalThis.isLLMStreamOutput) {
                import('./lib/non_stream.js').then(module => {
                    module.sendNonStreamMessage(socket, generatedText, request.requestId, request.outputId);
                });
            }
        } catch (error) {
            console.error('生成文本时出错:', error);
            addLogMessage('fail', `生成文本时出错: ${error}`, 'client', request.requestId);

            if (socket && socket.connected) {
                socket.emit(MSG_TYPE.ERROR, {
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
        // data: { functionName: string, args: any[] }
        // 向服务器发送 FUNCTION_CALL 请求
        socket.emit(MSG_TYPE.FUNCTION_CALL, data, (response) => {
            callback(response); // 将服务器的响应传递给回调函数
            isProcessingRequest = false;
            processRequest(); // 递归调用，处理下一个请求
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

    // 将请求添加到队列
    llmRequestQueue.push({ generateConfig, requestId: data.requestId, outputId: data.outputId });
    processRequest(); // 尝试处理请求
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
  if (!socket) {
    console.warn('Socket not connected.');
    return;
  }

  try {
    const rooms = await getRooms(socket);
    displayRoomList(rooms);
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

/**
 * @description 处理登录点击事件 / Handles the login click event.
 * @async
 * @function onLoginClick
 * @returns {Promise<void>}
 */
async function onLoginClick() {
    const password = $('#socketio-password').val();

    // 向服务器发送登录请求
    socket.emit(MSG_TYPE.LOGIN, { password }, (response) => {
        if (response.success) {
            $('#login-form').hide();
            $('#login-message').text('').removeClass('error');
            $('.button-group').show();
            $('.animated-details').show();

            connectToServer(); // 登录成功后自动连接
        } else {
            $('#login-message').text(response.message || 'Login failed.').addClass('error');
        }
    });
}

// 新增: 登录函数
async function onLoginClick() {
    const password = $('#socketio-password').val();

    // 向服务器发送登录请求
    socket.emit(MSG_TYPE.LOGIN, { password }, (response) => {
        if (response.success) {
            $('#login-form').hide();
            $('#login-message').text('').removeClass('error');
            $('.button-group').show();
            $('.animated-details').show();

            connectToServer(); // 登录成功后自动连接
        } else {
            $('#login-message').text(response.message || 'Login failed.').addClass('error');
        }
    });
}

// 新增: 生成并显示客户端密钥
async function generateAndDisplayClientKey() {
  const selectedClientId = $('#socketio-clientList').val();
  if (!selectedClientId) {
    toastr.warning('请选择一个客户端', '错误');
    return;
  }

  socket.emit(MSG_TYPE.GENERATE_CLIENT_KEY, { clientId: selectedClientId }, response => {
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

  socket.emit(MSG_TYPE.REMOVE_CLIENT_KEY, { clientId: selectedClientId }, response => {
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
  // 使用 function_call 从服务器获取设置
  socket.emit(
    MSG_TYPE.FUNCTION_CALL,
    {
      requestId: 'loadSettings', // 可以使用固定的 requestId
      functionName: 'readJsonFromFile',
      args: ['../server_settings.json'], // 文件路径 (相对于 server.js)
    },
    response => {
      if (response.success) {
        const settings = response.result;
        console.log('Loaded settings:', settings);

        // 将设置填充到 UI 元素
        $('#socketio-serverPortInput').val(settings.serverPort || '4000'); // 设置默认值
        $('#socketio-serverAddressInput').val(settings.serverAddress || 'http://localhost');
        // 其他设置...
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
    reconnectAttempts: 10,
    reconnectDelay: 1000,
    timeout: 5000,
    autoConnect: true,
    socketIOPath: '/socket.io',
    queryParameters: {},
    transport: 'websocket',
  };

  // 使用 function_call 将设置保存到服务器
  socket.emit(
    MSG_TYPE.FUNCTION_CALL,
    {
      requestId: 'saveSettings', // 可以使用固定的 requestId
      functionName: 'saveJsonToFile',
      args: ['./server_settings.json', settings], // 文件路径 (相对于 server.js)
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

  $('#socketio-disconnectBtn').on('click', onDisconnectClick);
  $('#socketio-testBtn').on('click', onTestClick);
  $('#socketio-saveSettingsBtn').on('click', saveSettings);

  $('#socketio-logFilter').on('change', filterLog);

  $('#socketio-refreshRoomsBtn').on('click', refreshRoomList);

  $('#socketio-loginBtn').on('click', onLoginClick);

  // testGenerate();

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

  const extensionName = $('#socketio-extensionName').val();

  eventSource.on(event_types.STREAM_TOKEN_RECEIVED, data => {
    if (messageForwarder.isStreamForwardingEnabled) {
      messageForwarder.handleStreamToken(data, messageForwarder.getMessageType(), extensionName); // 传入 extensionName
    } else if (messageForwarder.isNonStreamForwardingEnabled) {
      messageForwarder.accumulateStreamData(data);
    }
  });

  eventSource.on(event_types.MESSAGE_RECEIVED, messageId => {
    if (!globalThis.isLLMStreamOutput) {
      messageForwarder.handleNonStreamMessage(messageId, messageForwarder.getMessageType(), extensionName); // 传入 extensionName
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
    messageForwarder.sendAccumulatedData();
    generationStartedHandled = false;
  });

  eventSource.on(event_types.GENERATION_STOPPED, () => {
    messageForwarder.resetOutputId();
    messageForwarder.resetPreviousLLMData();
    messageForwarder.sendAccumulatedData();
    generationStartedHandled = false;
  });

  eventSource.on(event_types.STREAM_TOKEN_RECEIVED, handleStreamToken);
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

  // 加载设置
  loadSettings();
});
