# SillyTavern-NewAge: 基于 Socket.IO 的双向通信扩展

[![Status](https://img.shields.io/badge/status-very_early_alpha-red.svg)](https://shields.io/)

## 前言 (Introduction)

SillyTavern 是一个用户友好的界面，让你可以与文本生成 AI 进行交互和角色扮演。然而，SillyTavern 的扩展开发一直面临一些挑战：

*   **受限的 Node.js 模块：**  由于 SillyTavern 运行在沙盒环境中，开发者无法直接使用 Node.js 内置模块，很大程度上限制了扩展的功能。
*   **封装的 require：** SillyTavern 对 `require` 进行了封装，使得引入外部库变得困难。
*   **HTML 标签限制：**  不允许使用 HTML 标签进行全局声明，极大地限制了 UI 的构建方式。
*   **双向通信困难：**  在上述限制下，构建可持续的双向通信（例如 WebSocket）非常困难。

这些限制使得为 SillyTavern 构建一个与外部世界双向通信的桥梁变得异常困难。外部脚本似乎是唯一的选择……

但好在还有Socket.IO。

## Socket.IO 的优势 (The Advantages of Socket.IO)

Socket.IO 是一个强大的依赖库，可以实现客户端和服务器之间的实时、可持续的双向通信。更重要的是，它的客户端 API（`socket.io-client`）完全可以在浏览器环境中运行，无需任何 Node.js 依赖。这意味着：

*   **无需 Node.js 依赖：**  我们不需要依赖任何 Node.js 内置模块。
*   **告别 require 困境：**  无需处理 SillyTavern 封装的 `require`。
*   **无需打包：**  不需要打包任何依赖，只需引入 `socket.io.js` 文件即可。
*   **无冲突：**  客户端的所有通信方法都基于 `socket.io.js`，与其他库冲突的可能性极小。
*   **简单易用：**  只需 `socket = io()` 即可建立连接，开启双向通信的大门。

## 项目方向 (Development Direction)

本项目旨在利用 Socket.IO 的优势，为 SillyTavern 提供一个稳定、可靠的双向通信扩展。目前已实现以下功能：

*   **基础文本发送：**  支持向外部服务器发送文本消息。
*   **流式和非流式传输：**  支持流式（逐个 token）和非流式（一次性）两种消息传输方式。

未来的开发计划包括：

1.  **与 SillyTavern EventType 整合：** 确定如何更好地与 SillyTavern 的事件系统配合，以实现更精细的控制和更丰富的交互。
2.  **流式信息优化：** 针对流式传输进行性能优化，减少延迟，提高响应速度。
3.  **Function Calling 支持：**
    *   实现外部调用 SillyTavern 或前端助手提供的函数。
    *   允许外部程序修改 SillyTavern 的状态，例如：
        *   发送文本到 LLM。
        *   修改用户消息。
        *   切换角色卡。
        *   切换世界书。
        *   ... 以及更多高级功能。

## 潜在用途 (Potential Use Cases)

基于此扩展，可以实现许多令人兴奋的功能：

*   **基于 SillyTavern 的聊天机器人：**  创建更智能、更具交互性的聊天机器人，可以与外部服务集成。
*   **更强大的前端页面：** 开发具有更丰富功能和交互性的前端页面。
*    **AI 辅助写作/绘画：**  可以与外部的 AI 写作或绘画工具集成。
*   **游戏集成：**  将 SillyTavern 与游戏集成，实现角色扮演、剧情生成等功能。
* **远程控制:** 通过其它设备控制酒馆。
*   **数据分析和可视化：** 将 SillyTavern 的数据发送到外部服务器进行分析和可视化。

## 二次开发文档 (Documentation for Developers)

[点击此处查看二次开发文档](developer_readme.md) (待补充 / To be added)

我们鼓励开发者基于此扩展进行二次开发，创建更多有趣和实用的功能。 我们将提供详细的开发文档，帮助开发者快速上手。

## 鸣谢 (Acknowledgements)

*   感谢 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 团队提供的出色平台。
*   感谢 [Socket.IO](https://socket.io/) 团队开发的强大依赖库。

## 状态 (Status)

本项目仍处于非常早期的 alpha 阶段。 欢迎社区的反馈、建议和贡献！