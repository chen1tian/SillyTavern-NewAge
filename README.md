# SillyTavern-NewAge: 基于 Socket.IO 的双向通信扩展

[![Status](https://img.shields.io/badge/status-alpha-orange.svg)](https://shields.io/)

## 前言 (Introduction)

SillyTavern 是一个用户友好的界面，让你可以与文本生成 AI 进行交互和角色扮演。然而，SillyTavern 的扩展开发一直面临一些挑战：

*   **受限的 Node.js 模块：** 由于 SillyTavern 运行在沙盒环境中，开发者无法直接使用 Node.js 内置模块，这限制了扩展的功能。
*   **封装的 require：** SillyTavern 对 `require` 进行了封装，使得引入外部库变得困难。
*   **HTML 标签限制：** 不允许使用 HTML 标签进行全局声明，限制了 UI 的构建方式。
*   **双向通信困难：** 在上述限制下，构建可持续的双向通信（例如 WebSocket）非常困难。

这些限制使得为 SillyTavern 构建一个与外部世界双向通信的桥梁变得异常困难。

## Socket.IO 的优势 (The Advantages of Socket.IO)

Socket.IO 是一个强大的库，可以实现客户端和服务器之间的实时、可持续的双向通信。更重要的是，它的客户端 API（`socket.io-client`）完全可以在浏览器环境中运行，无需任何 Node.js 依赖。这意味着：

*   **无需 Node.js 依赖：** 我们不需要依赖任何 Node.js 内置模块。
*   **告别 require 困境：** 无需处理 SillyTavern 封装的 `require`。
*   **无需打包：** 不需要打包任何依赖，只需引入 `socket.io.js` 文件即可。
*   **无冲突：** 客户端的所有通信方法都基于 `socket.io-client`，与其他库冲突的可能性极小。
*   **简单易用：** 只需 `socket = io()` 即可建立连接，开启双向通信的大门。

## 项目目标 (Project Goals)

本项目旨在利用 Socket.IO 的优势，为 SillyTavern 提供一个稳定、可靠、安全且易于使用的双向通信扩展，实现 SillyTavern 与外部世界的无缝连接。

## 当前功能 (Current Features)

*   **双向通信**:
    *   支持 SillyTavern 扩展与服务器之间的双向文本消息传递。
    *   支持流式（逐 token）和非流式（一次性）消息传输。
    *   支持自定义消息类型和事件。
*   **连接管理**:
    *   自动重连机制（服务器可配置重试次数和延迟）。
    *   连接状态监控（连接、断开、错误、重连等）。
    *   客户端 ID 自动生成和管理。
    *   支持 "记住我" 功能，自动连接到服务器。
*   **安全**:
    *   客户端密钥认证（服务器端验证）。
    *   基于角色的权限控制（例如，只有 SillyTavern 扩展可以创建/删除房间、生成/移除客户端密钥）。
    *   SillyTavern 扩展密码登录 (可选)。
    *    SillyTavern扩展登录密码自动哈希 (服务器启动时)。
*   **房间管理**:
    *   支持创建、删除房间（仅限 SillyTavern 扩展）。
    *   支持将客户端添加到房间或从房间移除。
    *   支持获取房间列表和房间内的客户端列表。
    *    客户端断连自动重连, 重连失败自动删除房间。
*   **Function Calling**:
    *   支持服务器端注册和调用自定义函数。
    *   支持 SillyTavern 扩展通过服务器调用已注册的函数。
    *    支持服务器调用SillyTavern扩展端注册的函数 (通过前端助手)。
*   **消息路由**:
    *   支持基于消息类型、来源、目标和自定义规则的消息路由。
    *   支持向特定房间、特定客户端或所有客户端发送消息。
*   **请求队列**:
    *   SillyTavern 扩展端支持 LLM 请求和函数调用请求的排队处理，确保按顺序执行。
    *    服务器端不再需要请求队列。
*   **即时流式转发**:
    *   支持服务器接收到 SillyTavern 扩展发送的每个 token 后，立即转发给客户端。
*   **配置与自动加载**:
    *   支持从 UI 加载和保存服务器设置（如服务器地址、端口等）。
    *   支持从文件自动加载可信客户端和 SillyTavern 扩展列表。
*   **多 SillyTavern 实例支持**:
    *   支持多个 SillyTavern 扩展实例连接到同一个服务器。
    *   每个 SillyTavern 扩展实例自动分配一个唯一的 clientId。
* **与SillyTavern深度集成**
    * 通过前端助手，实现了与SillyTavern的事件、消息、生成等功能的深度集成。
* **日志记录**:
    * 详细的日志记录，方便调试和问题排查。

## 未来计划 (Future Plans)

1.  **增强安全性**:
    *   添加更严格的输入验证和防注入攻击措施。
    *   考虑使用 HTTPS 加密通信。

2.  **优化性能**:
    *   进一步优化流式传输性能。
    *   优化消息处理和路由效率。

3.  **扩展 API**:
    *   提供更丰富的 API，允许开发者更灵活地控制和扩展功能。

4.  **UI 增强**:
    *   提供更友好的用户界面，方便配置和管理。
    *   实时显示连接状态、房间信息、客户端信息等。

5.  **集成 SillyTavern**:
    *   与 SillyTavern 的事件系统更好地整合。
    *   提供更多与 SillyTavern 交互的功能 (例如，修改消息、切换角色等)。

6. **Function Calling优化**:
    *    扩展函数调用的功能, 允许服务器/客户端调用已注册的函数.

7.  **文档完善**:
    *   补充和完善开发文档。

## 潜在用途 (Potential Use Cases)

*   **聊天机器人**: 创建更智能、更具交互性的聊天机器人，可以与外部服务（如天气、新闻、知识库等）集成。
*   **AI 辅助工具**: 集成 AI 写作、绘画、代码生成等工具，增强 SillyTavern 的创作能力。
*   **游戏集成**: 将 SillyTavern 与游戏集成，实现角色扮演、剧情生成、游戏内聊天等功能。
*   **数据分析**: 将 SillyTavern 的数据发送到外部服务器进行分析和可视化。
*   **多用户协作**: 实现多个 SillyTavern 实例之间的协作，例如多人角色扮演、协同创作等。
*   **自定义前端**: 创建自定义的 SillyTavern 前端界面，提供更丰富的功能和更好的用户体验。
*   **SillyTavern 设置同步**: 通过服务器同步多个 SillyTavern 实例的设置。

## 开发文档 (Documentation for Developers)

*   [SillyTavern 扩展端开发文档](developer_readme_extension.md)
*   [服务器端开发文档](developer_readme_server.md)

我们鼓励开发者基于此扩展进行二次开发，创建更多有趣和实用的功能。

## 鸣谢 (Acknowledgements)

*   感谢 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 团队提供的出色平台。
*   感谢 [Socket.IO](https://socket.io/) 团队开发的强大库。
*   感谢 [前端助手](https://github.com/N0VI028/JS-Slash-Runner) 团队的工作。

## 状态 (Status)

本项目仍处于 alpha 阶段。 欢迎社区的反馈、建议和贡献！
