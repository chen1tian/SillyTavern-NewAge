// server/example/LLM_Role_Play/js/save_file.js

import { showLoadingOverlay, hideLoadingOverlay } from "./main.js";
import { io } from "../../../public/socket.io.js"; // 导入 socket.io-client
import { getSettings } from "./settings.js"; // 导入 getSettings 函数
import { NAMESPACES } from '../../../../lib/constants.js'; // 导入 NAMESPACES

/**
 * 将 JSON 数据保存到服务器上的文件
 * @param {string} filePath - 文件路径（相对于服务器根目录）
 * @param {object} jsonData - 要保存的 JSON 数据
 * @param {number} [attempts=1] - 当前重试次数 (内部使用)
 */
async function saveJsonToFile(filePath, jsonData, attempts = 1) {
  showLoadingOverlay(); // 显示加载遮罩

  try {
    const settings = getSettings(); // 获取服务器地址和其他设置
    //  转换 serverAddress
    const httpAddress = settings['server-address'].replace(/^ws/, 'http').replace(/^wss/, 'https');

    //  创建到 /function_call 命名空间的连接
    const socket = io(httpAddress + NAMESPACES.FUNCTION_CALL);


    //将路径转换
    const serverFilePath = filePath.replace(/^(\.\.\/|\.\/)?/, ''); // 移除开头的 ../ 或 ./
    const requestData = {
      filePath: `example/LLM_Role_Play/${serverFilePath}`, //  文件路径
      jsonData: jsonData,    // JSON 数据
    };

    //  使用 socket.io 发送请求
    return new Promise((resolve, reject) => {
      socket.emit('save_json', requestData, (response) => {
        socket.disconnect(); //  发送完请求后断开连接

        if (response.success) {
          console.log(`JSON data saved to ${filePath} successfully.`);
          resolve(response);
        } else {
          const errorMessage = response.error || 'Unknown error saving JSON data.';
          console.error(`Attempt ${attempts}: Error saving JSON data:`, errorMessage);

          //  重试逻辑
          if (attempts < settings['reconnect-attempts']) { // 【修改】使用方括号
            console.log(`Retrying in ${settings['reconnect-delay']} ms...`); // 【修改】使用方括号
            setTimeout(() => {
              saveJsonToFile(filePath, jsonData, attempts + 1) // 递归调用，增加 attempts
                .then(resolve) //  成功，resolve 最终的 Promise
                .catch(reject); //  失败，reject 最终的 Promise
            }, settings['reconnect-delay']); // 【修改】使用方括号
          } else {
            console.error('Max retry attempts reached. Giving up.');
            reject(new Error(errorMessage)); //  达到最大重试次数，reject
            hideLoadingOverlay(); //  隐藏加载遮罩
          }
        }
      });
      //  添加错误处理
      socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        socket.disconnect();
        reject(error); //  连接错误，直接 reject
        hideLoadingOverlay(); //  隐藏加载遮罩
      });
    });

  } catch (error) {
    console.error('Error saving JSON data:', error);
    hideLoadingOverlay(); // 确保隐藏加载遮罩
    return Promise.reject(error); //  返回 rejected promise
  }
}

export { saveJsonToFile };