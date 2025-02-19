//index.js

import { MSG_TYPE, STREAM_EVENTS, NAMESPACES } from './lib/constants.js';//与服务器共享的js
//import { sendNonStreamMessage } from './lib/non_stream.js';//与服务器共享的js, 这行无用
import { io } from "./lib/Socket.io/socket.io.js";//与服务器共享的js
import { uuidv4 } from './lib/uuid/uuid.js';//与服务器共享的js
import { eventSource, event_types } from "../../../../script.js";
import * as messageForwarder from "./dist/message_forwarder.js"; // 导入消息转发模块, 更改命名 / Import message forwarding module, rename

/**
 * 扩展名称 / Extension name
 * @type {string}
 */
const extensionName = "SillyTavern-NewAge";
/**
 * 扩展文件夹路径 / Extension folder path
 * @type {string}
 */
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

/**
 * Socket.IO 客户端实例 / Socket.IO client instance
 * @type {import("socket.io-client").Socket | null}
 */
let socket = null;

/**
 * 用于存储流数据的缓冲区 / Buffer for storing stream data
 * @type {string[]}
 */
let streamBuffer = [];

/**
 * 标记当前是否正在接收流 / Flag to indicate if stream is being received
 * @type {boolean}
 */
let isStreaming = false;

/**
 * 日志计数器 / Log counter
 * @type {number}
 */
let logCounter = 0;

/**
 * 添加日志消息到表格
 * Add a log message to the table
 * @param {string} type - 日志类型 (success, warning, fail, info)
 * @param {string} message - 日志消息 / Log message
 * @param {string} [source] - 消息来源 / Message source
 * @param {string} [requestId] - 请求 ID / Request ID  (替换 streamId)
 * @param {string} [outputId] - 输出 ID / Output ID
 */
function addLogMessage(type, message, source, requestId, outputId) { // 修改参数：requestId 替换 streamId
  const now = new Date();
  const timeString = now.toLocaleTimeString();
  const logTableBody = $("#socketio-logTableBody");

  /**
   * 截断字符串
   * Truncate a string
   * @param {string} str - 要截断的字符串 / String to truncate
   * @param {number} maxLength - 最大长度 / Maximum length
   * @returns {string} - 截断后的字符串 / Truncated string
   */
  function truncate(str, maxLength) {
    if (str === undefined || str === null) {
      return 'N/A';
    }
    return str.length > maxLength ? str.substring(0, maxLength) + "..." : str;
  }


  const maxMessageLength = 40;
  const maxSourceLength = 10;
  const maxRequestIdLength = 8; // requestId 长度限制
  const maxOutputIdLength = 8;


  const truncatedMessage = truncate(message, maxMessageLength);
  const truncatedSource = truncate(source, maxSourceLength);
  const truncatedRequestId = truncate(requestId, maxRequestIdLength); // 截断 requestId
  const truncatedOutputId = truncate(outputId, maxOutputIdLength);


  const timeCell = $("<td/>").text(timeString).addClass('log-time').attr('title', timeString);
  const typeCell = $("<td/>").text(type).addClass('log-type').attr('title', type);
  const messageCell = $("<td/>").text(truncatedMessage).addClass('log-message').attr('title', message);
  const sourceCell = $("<td/>").text(truncatedSource).addClass('log-source').attr('title', source);
  const requestIdCell = $("<td/>").text(truncatedRequestId).addClass('log-request-id').attr('title', requestId); // 使用 requestId
  const outputIdCell = $("<td/>").text(truncatedOutputId).addClass('log-output-id').attr('title', outputId);

  const row = $("<tr/>").addClass(type);
  row.append(timeCell, typeCell, messageCell, sourceCell, requestIdCell, outputIdCell); // 使用 requestIdCell

  logTableBody.append(row);
  logCounter++;
  filterLog();
}


/**
 * 根据选择的类型过滤日志
 * Filter log messages based on the selected type
 */
function filterLog() {
  const selectedFilter = $("#socketio-logFilter").val();

  $("#socketio-logTableBody tr").each(function () {
    const row = $(this);
    let showRow = false;

    if (selectedFilter === "all") {
      showRow = true;
    } else if (selectedFilter.startsWith("source-")) {
      const source = selectedFilter.substring("source-".length);
      showRow = row.find(".log-source").text() === source;
    } else {
      showRow = row.hasClass(selectedFilter);
    }

    row.toggle(showRow);
  });
}

/**
 * 更新按钮状态
 * Updates the status of the connect and disconnect buttons
 * @param {boolean} isConnected - 是否已连接 / Whether connected
 */
function updateButtonState(isConnected) {
  $("#socketio-connectBtn").prop("disabled", isConnected);
  $("#socketio-disconnectBtn").prop("disabled", !isConnected);
}

/**
 * 连接到 Socket.IO 服务器
 * Connect to the Socket.IO server
 */
function onConnectClick() {
  const serverAddress = $("#socketio-serverAddressInput").val();
  const serverPort = $("#socketio-serverPortInput").val();
  const fullServerAddress = `${serverAddress}:${serverPort}`;

  socket = io(fullServerAddress + NAMESPACES.GENERAL);
  globalThis.socket = socket;

  // 【新增】SillyTavern 身份认证
  socket.emit(MSG_TYPE.IDENTIFY_SILLYTAVERN);

  socket.on('connect', () => {
    addLogMessage('success', '已连接到服务器', 'client');
    updateButtonState(true); // 已连接，更新按钮状态
    //$("#socketio-connectBtn").prop("disabled", true); // 已连接，禁用连接按钮
    //$("#socketio-disconnectBtn").prop("disabled", false);  //已连接，启用断开按钮
    $("#socketio-testBtn").prop("disabled", false);
    console.log('Socket.IO: Connected');
    toastr.success('Socket.IO: 已连接', 'Socket.IO');
  });

  socket.on('message', (data) => {
    if (data.type === MSG_TYPE.NON_STREAM) {
      addLogMessage('info', `服务器: ${data.data}`, data.source, data.requestId, data.outputId); // 使用 requestId
      console.log('Socket.IO: Message received', data);

      if (data.data === "Yes,connection is fine.") {
        toastr.success("连接活跃!", "测试连接");
      } else {
        //toastr.info(`服务器: ${data.data}`, 'Socket.IO 消息');
      }
    }
  });

  /**
   * @param {object} data
   */
  socket.on(STREAM_EVENTS.START_RESPONSE, (data) => {
    if (data.type === MSG_TYPE.STREAM_START) {
      streamBuffer = [];
      isStreaming = true;
      addLogMessage('info', '开始接收流...', data.source, data.requestId, data.outputId); // 使用 requestId
      console.log('Socket.IO: Stream started (response)', data);
    }
  });

  /**
   * @param {object} data
   */
  socket.on(STREAM_EVENTS.DATA_FIRST_RESPONSE, (data) => {
    if (data.type === MSG_TYPE.STREAM_DATA_FIRST) {
      addLogMessage('info', `接收到流数据（首块）...`, data.source, data.requestId, data.outputId); // 使用 requestId
      console.log('Socket.IO: First chunk received (response)', data);
      streamBuffer.push(data.data);
    }
  });

  /**
   * @param {object} data
   */
  socket.on(STREAM_EVENTS.DATA_MIDDLE_RESPONSE, (data) => {
    if (data.type === MSG_TYPE.STREAM_DATA_MIDDLE) {
      addLogMessage('info', `接收到流数据（中块）...`, data.source, data.requestId, data.outputId); // 使用 requestId
      console.log('Socket.IO: Middle chunk received (response)', data);
      streamBuffer.push(data.data);
    }
  });

  /**
   * @param {object} data
   */
  socket.on(STREAM_EVENTS.DATA_LAST_RESPONSE, (data) => {
    if (data.type === MSG_TYPE.STREAM_DATA_LAST) {
      addLogMessage('info', `接收到流数据（末块）...`, data.source, data.requestId, data.outputId); // 使用 requestId
      console.log('Socket.IO: Last chunk received (response)', data);
      streamBuffer.push(data.data);
    }
  });

  /**
   * @param {object} data
   */
  socket.on(STREAM_EVENTS.DATA_RETRY_RESPONSE, (data) => {
    if (data.type === MSG_TYPE.STREAM_DATA_RETRY) {
      addLogMessage('info', `接收到流数据（重试）...`, data.source, data.requestId, data.outputId); // 使用 requestId
      console.log('Socket.IO: Stream retry (response)', data);
      streamBuffer.push(data.data);
    }
  });

  /**
   * @param {object} data
   */
  socket.on(STREAM_EVENTS.DATA_FAILED_RESPONSE, (data) => {
    if (data.type === MSG_TYPE.STREAM_DATA_FAILED) {
      addLogMessage('fail', '流错误', data.source, data.requestId, data.outputId); // 使用 requestId
      console.log('Socket.IO: Stream error (response)', data);
      isStreaming = false;
    }
  });

  /**
   * 用于记录上一次 toastr.success 的 outputId / Used to record the outputId of the last toastr.success
   * @type {string | null}
   */
  let lastToastrOutputId = null;

  /**
   * @param {object} data
   */
  socket.on(STREAM_EVENTS.END_RESPONSE, (data) => {
    if (data.type === MSG_TYPE.STREAM_END) {
      if (isStreaming) {
        isStreaming = false;
        const fullMessage = streamBuffer.join('');
        addLogMessage('success', `流内容: ${fullMessage}`, data.source, data.requestId, data.outputId); // 使用 requestId
        console.log('Socket.IO: Stream ended, Content:', fullMessage);

        // 避免重复的 toastr.success / Avoid duplicate toastr.success
        if (data.outputId !== lastToastrOutputId) {
          //toastr.success('流已结束', 'Socket.IO 流');
          lastToastrOutputId = data.outputId; // 更新 / Update
        }

        streamBuffer = [];
      }
    }
  });

  // 【新增】监听 LLM_REQUEST 消息
  socket.on(MSG_TYPE.LLM_REQUEST, (data) => {
    addLogMessage('info', `Received LLM request: ${data.message}`, 'server', data.requestId);
    toastr.info(`Received LLM request: ${data.message}`, 'LLM Request');
    // 在这里处理 LLM 请求 (目前只是用 toastr 显示)
    console.log('Received LLM request:', data);
  });

  socket.on(MSG_TYPE.LLM_RESPONSE, (data) => { // 新增: 监听 LLM 响应
    // 在这里处理来自服务器的 LLM 响应
    addLogMessage('info', `Received LLM response: ${data.message}`, 'server', data.requestId);
    console.log('Received LLM response:', data);
  });

  // 在 disconnect, connect_error, reconnect_failed 事件中重置按钮状态
  socket.on('disconnect', (reason) => {
    addLogMessage('warning', `与服务器断开连接: ${reason}`, 'client');
    updateButtonState(false);  // 断开连接，更新按钮状态
    //$("#socketio-connectBtn").prop("disabled", false); // 断开连接，启用连接按钮
    //$("#socketio-disconnectBtn").prop("disabled", true); //断开连接，禁用断开按钮
    $("#socketio-testBtn").prop("disabled", true); //断开连接，禁用测试按钮
    socket = null;
    globalThis.socket = null;
    console.log('Socket.IO: Disconnected');
    toastr.warning(`已断开连接: ${reason}`, 'Socket.IO');
  });

  socket.on('connect_error', (error) => {
    addLogMessage('fail', `连接错误: ${error}`, 'client');
    updateButtonState(false); // 连接错误，更新按钮状态
    //$("#socketio-connectBtn").prop("disabled", false); // 连接错误，启用连接按钮
    console.error('Socket.IO: Connection error', error);
    toastr.error(`连接错误: ${error}`, 'Socket.IO');
  });

  socket.on('reconnect_failed', () => {
    addLogMessage('fail', '重连失败', 'client');
    updateButtonState(false); // 重连失败，更新按钮状态
    //$("#socketio-connectBtn").prop("disabled", false); // 重连失败，启用连接按钮
    console.error('Socket.IO: Reconnect failed');
    toastr.error('重连失败', 'Socket.IO');
  });
}

/**
 * 断开与 Socket.IO 服务器的连接
 * Disconnect from the Socket.IO server
 */
function onDisconnectClick() {
  if (socket) {
    socket.disconnect();
  }
}

/**
 * 测试与 Socket.IO 服务器的连接
 * Test the connection with the Socket.IO server
 */
function onTestClick() {
  if (socket && socket.connected) {
    import('./lib/non_stream.js').then(module => {
      module.sendNonStreamMessage(socket, "Connection active?");
    });
  }
}

/**
 * 处理接收到的流式 Token
 * Handle incoming stream tokens
 * @param {object} data - 接收到的数据 / Received data
 */
function handleStreamToken(data) {
  messageForwarder.handleStreamToken(data, messageForwarder.getMessageType());
}

/**
 * 更新转发选项的可见性
 * Updates the visibility of forwarding options
 */
function updateForwardingOptionsVisibility() {
  const defaultForwardingChecked = $("#socketio-defaultForwarding").is(":checked");
  $("#message-handling-options").toggle(true); // 默认总是显示 message-handling-options / Always show message-handling-options by default

  // 如果 "默认转发行为" 未选中，则隐藏内部的两个复选框 / If "Default Forwarding Behavior" is not checked, hide the two internal checkboxes
  if (defaultForwardingChecked) {
    $("#socketio-enableStream").parent().hide(); // 隐藏 label / Hide label
    $("#socketio-enableNonStream").parent().hide();
  } else {
    // 如果 "默认转发行为" 选中，则显示内部的两个复选框 / If "Default Forwarding Behavior" is checked, show the two internal checkboxes
    $("#socketio-enableStream").parent().show();
    $("#socketio-enableNonStream").parent().show();
  }
  // 如果 "默认转发行为" 未选中，则执行互斥逻辑检查 / If "Default Forwarding Behavior" is not checked, perform mutex logic check
  if (!defaultForwardingChecked) {
    // 检查互斥条件并进行相应处理 / Check mutex conditions and handle accordingly
    checkAndHandleMutex();
  }
}

/**
 * 检查并处理互斥情况（流式转发和非流式转发不能同时启用）
 * Checks and handles mutex cases (streaming and non-streaming forwarding cannot be enabled at the same time)
 * @returns {boolean} - 如果存在互斥情况则返回 true，否则返回 false / Returns true if a mutex case exists, false otherwise
 */
function checkAndHandleMutex() {
  // 互斥逻辑 / Mutex logic
  if ($("#socketio-enableStream").is(":checked") && $("#socketio-enableNonStream").is(":checked")) {
    console.warn("流式转发和非流式转发不能同时启用。已禁用所有转发。");
    toastr.warning("流式转发和非流式转发不能同时启用。已禁用所有转发。", "配置错误");
    messageForwarder.disableStreamForwarding();
    messageForwarder.disableNonStreamForwarding();
    // 取消两个复选框的选中状态 / Uncheck both checkboxes
    $("#socketio-enableStream").prop("checked", false);
    $("#socketio-enableNonStream").prop("checked", false);
    return true; // 表示存在互斥 / Indicates a mutex case exists
  }
  return false; // 表示不存在互斥 / Indicates no mutex case exists
}

/**
 * 初始化扩展
 * Initialize the extension
 */
jQuery(async () => {
  const settingsHtml = await $.get(`${extensionFolderPath}/index.html`);
  $("#extensions_settings").append(settingsHtml);

  $("#socketio-connectBtn").on("click", onConnectClick);
  $("#socketio-disconnectBtn").on("click", onDisconnectClick);
  $("#socketio-testBtn").on("click", onTestClick);
  $("#socketio-saveSettingsBtn").on("click", () => {
    toastr.info("尚未实现", "保存设置");
  });

  $("#socketio-logFilter").on("change", filterLog);

  // 监听 "默认转发行为" 复选框的 change 事件 / Listen for the change event of the "Default Forwarding Behavior" checkbox
  $("#socketio-defaultForwarding").on("change", function () {
    updateForwardingOptionsVisibility();

    // 如果选中了 "默认转发行为"，则根据 stream_toggle 的状态强制设置转发方式 / If "Default Forwarding Behavior" is checked, force the forwarding method based on the state of stream_toggle
    if (this.checked) {
      const isStreaming = $("#stream_toggle").is(":checked");
      if (isStreaming) {
        messageForwarder.enableStreamForwarding();
        messageForwarder.disableNonStreamForwarding(); // 确保非流式被禁用 / Ensure non-streaming is disabled
      } else {
        messageForwarder.disableStreamForwarding(); // 确保流式被禁用 / Ensure streaming is disabled
        messageForwarder.enableNonStreamForwarding();
      }
    }
  });

  // 监听 stream_toggle 的 change 事件 (控制 SillyTavern 内部的 LLM 输出形式) / Listen for the change event of stream_toggle (controls the LLM output format inside SillyTavern)
  $("#stream_toggle").on("change", function () {
    globalThis.isLLMStreamOutput = this.checked;
    console.log('stream_toggle:', isLLMStreamOutput);

    // 如果 "默认转发行为" 已选中，则根据 stream_toggle 的状态强制设置转发方式 / If "Default Forwarding Behavior" is checked, force the forwarding method based on the state of stream_toggle
    if ($("#socketio-defaultForwarding").is(":checked")) {
      if (this.checked) {
        messageForwarder.enableStreamForwarding();
        messageForwarder.disableNonStreamForwarding();
      } else {
        messageForwarder.disableStreamForwarding();
        messageForwarder.enableNonStreamForwarding();
      }
    }
  });

  // 监听流式转发复选框的 change 事件 / Listen for the change event of the stream forwarding checkbox
  $("#socketio-enableStream").on("change", function () {
    // 互斥逻辑 (只有在 "默认转发行为" 未选中的情况下才执行) / Mutex logic (only executed if "Default Forwarding Behavior" is not checked)
    if (!$("#socketio-defaultForwarding").is(":checked") && checkAndHandleMutex()) {
      return; // 如果存在互斥，则直接返回 / If a mutex case exists, return directly
    }

    if (this.checked) {
      messageForwarder.enableStreamForwarding();
    } else {
      messageForwarder.disableStreamForwarding();
    }
  });

  // 监听非流式转发复选框的 change 事件 / Listen for the change event of the non-stream forwarding checkbox
  $("#socketio-enableNonStream").on("change", function () {
    // 互斥逻辑 (只有在 "默认转发行为" 未选中的情况下才执行) / Mutex logic (only executed if "Default Forwarding Behavior" is not checked)
    if (!$("#socketio-defaultForwarding").is(":checked") && checkAndHandleMutex()) {
      return; // 如果存在互斥，则直接返回 / If a mutex case exists, return directly
    }

    if (this.checked) {
      messageForwarder.enableNonStreamForwarding();
    } else {
      messageForwarder.disableNonStreamForwarding();
    }
  });

  // 在扩展初始化时检查流式输出是否开启 / Check if stream output is enabled when the extension is initialized
  globalThis.isLLMStreamOutput = $("#stream_toggle").is(":checked");
  console.log('isStreamToggle:', isLLMStreamOutput)
  if (isLLMStreamOutput) {
    messageForwarder.enableStreamForwarding();
    messageForwarder.disableNonStreamForwarding();
  } else {
    messageForwarder.disableStreamForwarding();
    messageForwarder.enableNonStreamForwarding();
  }

  //初始化时更新可见性 / update visibility on initialization
  updateForwardingOptionsVisibility();

  // 监听 STREAM_TOKEN_RECEIVED 事件 / Listen for the STREAM_TOKEN_RECEIVED event
  eventSource.on(event_types.STREAM_TOKEN_RECEIVED, (data) => {
    if (messageForwarder.isStreamForwardingEnabled) {
      //   console.log('流式已启用');
      messageForwarder.handleStreamToken(data, messageForwarder.getMessageType());
    }
    else if (messageForwarder.isNonStreamForwardingEnabled) {
      // console.log('非流式已启用');
      messageForwarder.accumulateStreamData(data);
    }
  });

  /**
   * @param {string} messageId
   */
  eventSource.on(event_types.MESSAGE_RECEIVED, (messageId) => {
    if (!globalThis.isLLMStreamOutput) { // 关键：只处理非流式输出 / Key: Only process non-streaming output
      messageForwarder.handleNonStreamMessage(messageId, messageForwarder.getMessageType());
    }
  });

  // 用于确保 GENERATION_STARTED 事件只被处理一次的标志 / Flag to ensure GENERATION_STARTED event is only handled once
  let generationStartedHandled = false;

  // 监听 GENERATION_STARTED 事件 / Listen for the GENERATION_STARTED event
  eventSource.on(event_types.GENERATION_STARTED, () => {
    if (!generationStartedHandled) {
      messageForwarder.setNewOutputId();
      messageForwarder.resetPreviousLLMData();
      generationStartedHandled = true; // 设置标志，阻止后续执行 / Set flag to prevent subsequent executions
    }
  });

  // 监听 GENERATION_ENDED 事件 / Listen for the GENERATION_ENDED event
  eventSource.on(event_types.GENERATION_ENDED, () => {
    messageForwarder.resetOutputId();
    messageForwarder.resetPreviousLLMData();
    messageForwarder.sendAccumulatedData();
    generationStartedHandled = false; // 重置标志 / Reset flag
  });

  // 监听 GENERATION_STOPPED 事件 / Listen for the GENERATION_STOPPED event
  eventSource.on(event_types.GENERATION_STOPPED, () => {
    messageForwarder.resetOutputId();
    messageForwarder.resetPreviousLLMData();
    messageForwarder.sendAccumulatedData();
    generationStartedHandled = false; // 重置标志 / Reset flag
  });

  // 监听 STREAM_TOKEN_RECEIVED 事件 / Listen for the STREAM_TOKEN_RECEIVED event
  eventSource.on(event_types.STREAM_TOKEN_RECEIVED, handleStreamToken);
});