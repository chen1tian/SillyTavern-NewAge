// example/LLM_Role_Play/js/log.js
import { getSettings } from "./settings.js";

let logCounter = 0;
// 将 addLogMessage 函数添加到全局作用域

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
  const timeString = now.toLocaleString();
  const logTableBody = document.getElementById("socketio-logTableBody");

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


  const timeCell = document.createElement("td");
  timeCell.textContent = timeString;
  timeCell.classList.add('log-time');
  timeCell.setAttribute('title', timeString);

  const typeCell = document.createElement("td");
  typeCell.textContent = type;
  typeCell.classList.add('log-type')
  typeCell.setAttribute('title', type);

  const messageCell = document.createElement("td");
  messageCell.textContent = truncatedMessage;
  messageCell.classList.add('log-message')
  messageCell.setAttribute('title', message);

  const sourceCell = document.createElement("td");
  sourceCell.textContent = truncatedSource;
  sourceCell.classList.add('log-source');
  sourceCell.setAttribute('title', source);

  const requestIdCell = document.createElement("td");
  requestIdCell.textContent = truncatedRequestId;
  requestIdCell.classList.add('log-request-id');
  requestIdCell.setAttribute('title', requestId);

  const outputIdCell = document.createElement("td");
  outputIdCell.textContent = truncatedOutputId;
  outputIdCell.classList.add('log-output-id');
  outputIdCell.setAttribute('title', outputId);


  const row = document.createElement("tr");
  row.classList.add(type);
  row.append(timeCell, typeCell, messageCell, sourceCell, requestIdCell, outputIdCell); // 使用 requestIdCell

  logTableBody.append(row);
  logCounter++;
  filterLog();
}

//筛选日志
function filterLog() {
  const logFilter = document.getElementById('socketio-logFilter').value;
  const logTableBody = document.getElementById('socketio-logTableBody');
  const rows = logTableBody.querySelectorAll('tr');

  rows.forEach(row => {
    if (logFilter === 'all') {
      row.style.display = ''; // 显示所有行
    } else if (logFilter.startsWith('source-')) {
      const source = logFilter.split('-')[1];
      if (row.querySelector('.log-source').textContent === source) {
        row.style.display = ''; // 显示匹配 source 的行
      } else {
        row.style.display = 'none'; // 隐藏不匹配的行
      }

    } else {
      if (row.classList.contains(logFilter)) {
        row.style.display = ''; // 显示匹配类型的行
      } else {
        row.style.display = 'none'; // 隐藏不匹配的行
      }
    }
  });
}
//初始化日志
function initLogFilter() {
  const logFilterSelect = document.getElementById('socketio-logFilter');
  //logFilterSelect.addEventListener('change', filterLog);
}

// 【新增】导出 addLogMessage 给 settings.js 使用
export { addLogMessage, initLogFilter, filterLog };