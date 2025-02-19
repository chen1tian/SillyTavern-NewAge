// monitor.js

import { STREAM_EVENTS, MSG_TYPE } from '../../../lib/constants.js';
import { typewriterEffectGeneric, handleData, initializeStreamRow, updateStreamStatus } from '../utils.js';  // 导入函数

const streamsTableBody = document.querySelector('#streams tbody');
const streamDataTextArea = document.getElementById('streamDataTextArea');
const activeOutputs = {}; // { outputId: { row: HTMLTableRowElement, buffer: string, status: string, chunks: string[], currentIndex: number, requestId: string } }

let currentOutputId = null;

const socket = io({
  auth: {
    clientType: 'monitor' //或visual-novel
  }
});

socket.on('connect', () => {
  console.log('Connected to server (monitor)');
  socket.emit('getRooms');
});

socket.on('roomsInfo', (rooms) => {
  console.log('Current rooms (monitor):', rooms);
});

// 统一的流数据处理 (Unified stream data handling)
socket.on(STREAM_EVENTS.START_RESPONSE, (data) => {
  console.log('stream-start event received:', data);
  initializeStreamRow(data, activeOutputs, streamsTableBody, (outputId, streamData) => {
    // Row click handler (enhanced to show requestId)
    let chunksContent = '';
    if (streamData.chunks) {
      for (let i = 0; i < streamData.chunks.length; i++) {
        chunksContent += `Chunk ${i}: ${streamData.chunks[i]}\n`;
      }
    }
    alert(`Output ID: ${outputId}\nRequest ID: ${streamData.requestId}\nStatus: ${streamData.status}\nChunks:\n${chunksContent}\nFull Content:\n${streamData.buffer}`);
  });
});

// 使用 handleData 处理所有数据事件 (Handle all data events using handleData)
socket.on(STREAM_EVENTS.DATA_FIRST_RESPONSE, (data) => handleStreamData(data));
socket.on(STREAM_EVENTS.DATA_MIDDLE_RESPONSE, (data) => handleStreamData(data));
socket.on(STREAM_EVENTS.DATA_LAST_RESPONSE, (data) => handleStreamData(data));
socket.on(STREAM_EVENTS.DATA_RETRY_RESPONSE, (data) => handleStreamData(data));
socket.on(STREAM_EVENTS.DATA_FAILED_RESPONSE, (data) => handleStreamData(data));
socket.on('message', (data) => handleStreamData(data));


function handleStreamData(data) {
  handleData(
    data,
    activeOutputs,
    (outputId, status) => {
      updateStreamStatus(activeOutputs, outputId, streamsTableBody, status)
    },
    (outputId, initialData) => { // onStreamStart
      // 在 onStreamStart 中，你可以选择立即显示 initialData (不使用打字机效果)
      // 或者什么也不做，等待 STREAM_DATA_LAST
      // streamDataTextArea.value = initialData; // 可以注释掉这一行
      if (outputId !== currentOutputId) {
        //streamDataTextArea.value = ''; // 清空, 或者你可以选择不清空
      }
      currentOutputId = outputId;
    },
    (outputId, currentText) => { // onStreamData
      // onStreamData 现在只在 typewriterEffectGeneric 更新时被调用
      if (outputId === currentOutputId) {
        streamDataTextArea.value = currentText;
      }
    },
    (outputId) => { // onStreamComplete
      // 在打字机效果完成后，这里会被调用
      console.log("Stream completed:", outputId);
    },
    (outputId, data) => { // onNonStreamData
      streamDataTextArea.value = data;
      currentOutputId = outputId;
    },
    { typewriterCharsToType: 1, typewriterInterval: 30 }
  );
}

socket.on(STREAM_EVENTS.END_RESPONSE, (data) => {
  console.log('stream-end event received:', data);
  updateStreamStatus(activeOutputs, data.outputId, streamsTableBody, (activeOutputs[data.outputId].status != "Failed" && activeOutputs[data.outputId].status != "Interrupted") ? 'Completed' : activeOutputs[data.outputId].status);
});

// 监听连接断开事件
socket.on('disconnect', () => {
  console.log('Disconnected from server (monitor)');
  for (const outputId in activeOutputs) {
    updateStreamStatus(activeOutputs, outputId, streamsTableBody, 'Interrupted');
  }
});

// 监听连接错误事件
socket.on('connect_error', (error) => {
  console.error('Connection error (monitor):', error);
});

// 监听重连事件
socket.on('reconnect', (attemptNumber) => {
  console.log('Reconnected to server (monitor) after attempt:', attemptNumber);
});

// 监听重连尝试事件
socket.on('reconnect_attempt', (attemptNumber) => {
  console.log('Reconnection attempt (monitor):', attemptNumber);
  for (const outputId in activeOutputs) {
    updateStreamStatus(activeOutputs, outputId, streamsTableBody, 'Retrying');
  }
});

// 监听重连失败事件
socket.on('reconnect_failed', () => {
  console.error('Reconnection failed (monitor)');
  for (const outputId in activeOutputs) {
    updateStreamStatus(activeOutputs, outputId, streamsTableBody, 'Failed');
  }
});