// server/dist/debug.js

import * as Keys from './Keys.js'; // 假设你有 Keys.js
import { NAMESPACES } from '../lib/constants.js'; // 假设你有 constants.js
import { io } from '../server.js'; // 从 server.js 导入 io 对象

/**
 * 添加调试客户端 (SillyTavern 和普通客户端)
 * @param {object} serverSettings - 服务器设置对象
 * @param {Set<string>} trustedSillyTaverns - 可信 SillyTavern 客户端集合
 * @param {Set<string>} trustedClients - 可信普通客户端集合
 * @param {Map<string, object>} connectedClients - 已连接客户端 Map
 * @param {Array<object>} clients - 客户端数组
 */
async function addDebugClients(serverSettings, trustedSillyTaverns, trustedClients, connectedClients, clients) {
  if (!serverSettings.debugMode) {
    return;
  }

  const debugSillyTavernClientId = 'SillyTavern-debug';
  const debugClientClientId = 'client-debug';

  // 添加 SillyTavern 调试客户端
  if (!trustedSillyTaverns.has(debugSillyTavernClientId)) {
    trustedSillyTaverns.add(debugSillyTavernClientId);
    await Keys.generateAndStoreClientKey(debugSillyTavernClientId);

    connectedClients.set(debugSillyTavernClientId, {
      clientId: debugSillyTavernClientId,
      clientType: 'SillyTavern',
      desc: 'Debug SillyTavern Client',
    });

    clients.push({
      clientId: debugSillyTavernClientId,
      clientType: 'SillyTavern',
      desc: 'Debug SillyTavern Client',
    });
  }

  // 添加普通调试客户端
  if (!trustedClients.has(debugClientClientId)) {
    trustedClients.add(debugClientClientId);
    await Keys.generateAndStoreClientKey(debugClientClientId);

    connectedClients.set(debugClientClientId, {
      clientId: debugClientClientId,
      clientType: 'extension',
      clientHTML: 'http://debugMode.com',
      desc: 'Debug Client',
    });
    clients.push({
      clientId: debugClientClientId,
      clientType: 'extension',
      clientHTML: 'http://debugMode.com',
      desc: 'Debug Client',
    });
  }
}

/**
 * 移除调试客户端
 * @param {object} serverSettings - 服务器设置对象
 * @param {Set<string>} trustedSillyTaverns - 可信 SillyTavern 客户端集合
 * @param {Set<string>} trustedClients - 可信普通客户端集合
 * @param {Map<string, object>} connectedClients - 已连接客户端 Map
 * @param {Array<object>} clients - 客户端数组
 */
async function removeDebugClients(serverSettings, trustedSillyTaverns, trustedClients, connectedClients, clients) {
  if (!serverSettings.debugMode) {
    return;
  }

  const debugSillyTavernClientId = 'SillyTavern-debug';
  const debugClientClientId = 'client-debug';

  // 移除 SillyTavern 调试客户端
  if (trustedSillyTaverns.has(debugSillyTavernClientId)) {
    trustedSillyTaverns.delete(debugSillyTavernClientId);
    await Keys.removeClientKey(debugSillyTavernClientId);
    connectedClients.delete(debugSillyTavernClientId)
    clients.length = 0; // 清空数组
  }

  // 移除普通调试客户端
  if (trustedClients.has(debugClientClientId)) {
    trustedClients.delete(debugClientClientId);
    await Keys.removeClientKey(debugClientClientId);
    connectedClients.delete(debugClientClientId);
    clients.length = 0;
  }
}

export { addDebugClients, removeDebugClients };