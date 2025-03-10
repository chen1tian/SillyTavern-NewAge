# SillyTavern-NewAge: 基于 Socket.IO 的双向通信扩展

[![Status](https://img.shields.io/badge/status-alpha-orange.svg)](https://shields.io/)

## 目录

- [SillyTavern-NewAge: 基于 Socket.IO 的双向通信扩展](#sillytavern-newage-基于-socketio-的双向通信扩展)
  - [目录](#目录)
  - [前言 (Introduction)](#前言-introduction)
  - [为什么选择 Socket.IO 而不是 WebSocket？](#为什么选择-socketio-而不是-websocket)
  - [项目目标 (Project Goals)](#项目目标-project-goals)
  - [当前功能 (Current Features)](#当前功能-current-features)
  - [未来计划 (Future Plans)](#未来计划-future-plans)
  - [潜在用途 (Potential Use Cases)](#潜在用途-potential-use-cases)
  - [使用方法 (How to Use)](#使用方法-how-to-use)
  - [开发文档 (Documentation for Developers)](#开发文档-documentation-for-developers)
  - [鸣谢 (Acknowledgements)](#鸣谢-acknowledgements)
  - [状态 (Status)](#状态-status)

## 前言 (Introduction)

SillyTavern 是一个用户友好的界面，让你可以与文本生成 AI 进行交互和角色扮演。然而，SillyTavern 的扩展开发一直面临一些挑战：

- **受限的 Node.js 模块：** 由于 SillyTavern 运行在沙盒环境中，开发者无法直接使用 Node.js 内置模块，这限制了扩展的功能。
- **封装的 require：** SillyTavern 对 `require` 进行了封装，使得引入外部库变得困难。
- **HTML 标签限制：** 不允许使用 HTML 标签进行全局声明，限制了 UI 的构建方式。
- **双向通信困难：** 在上述限制下，构建可持续的双向通信（例如 WebSocket）非常困难。

这些限制使得为 SillyTavern 构建一个与外部世界双向通信的桥梁变得异常困难。

## 为什么选择 Socket.IO 而不是 WebSocket？

虽然 WebSocket 提供了基本的双向通信功能，但 Socket.IO 在其基础上提供了更多高级特性，使其成为 SillyTavern 扩展的理想选择：

| 特性             | WebSocket                               | Socket.IO                                                                                                  |
| :--------------- | :-------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| **连接协议**    | 基础的双向通信协议。                    | 在 WebSocket 基础上提供更高级的抽象，支持自动重连、多路复用 (命名空间)、广播、房间等。                  |
| **自动重连**    | 不支持。                                | 内置自动重连机制，可配置重试次数和延迟。                                                                |
| **多路复用**    | 不支持。                                | 支持命名空间 (Namespaces)，允许在单个连接上建立多个虚拟连接，隔离不同的通信通道。                      |
| **广播/房间**    | 不支持。                                | 支持向特定房间或所有客户端广播消息，方便实现群组通信。                                                      |
| **消息确认**    | 不支持。                                | 支持消息确认机制，确保消息可靠传输。                                                                      |
| **兼容性**      | 现代浏览器广泛支持，但旧版本可能存在问题。 | 提供了对旧版本浏览器和不支持 WebSocket 的环境的回退机制 (例如，使用轮询)。                            |
| **客户端库**    | 浏览器原生支持，但功能有限。            | 提供功能丰富的客户端库 (`socket.io-client`)，易于使用，且无需 Node.js 依赖，可在浏览器中直接运行。 |
| **服务器端库**  | 需要手动实现服务器端逻辑。              | 提供多种语言的服务器端库 (例如，Node.js 的 `socket.io`)，简化服务器端开发。                          |
| **易用性**     | 需要手动处理连接管理、消息解析等。   | 提供了更高级的 API，简化了开发流程。                                                                       |

**总结：** Socket.IO 在 WebSocket 的基础上提供了更高级的抽象和功能，使得构建稳定、可靠、功能丰富的双向通信应用更加容易，特别是在 SillyTavern 扩展开发的受限环境中，Socket.IO 的优势更加明显。

## 项目目标 (Project Goals)

本项目旨在利用 Socket.IO 的优势，为 SillyTavern 提供一个稳定、可靠、安全且易于使用的双向通信扩展，实现 SillyTavern 与外部世界的无缝连接。

## 当前功能 (Current Features)

- **双向通信**:
  - 支持 SillyTavern 扩展与服务器之间的双向文本消息传递。
  - 支持流式（逐 token）和非流式（一次性）消息传输。
  - 支持自定义消息类型和事件。
- **连接管理**:
  - 自动重连机制（服务器可配置重试次数和延迟）。
  - 连接状态监控（连接、断开、错误、重连等）。
  - 客户端 ID 自动生成和管理。
  - 支持 "记住我" 功能，自动连接到服务器。
- **安全**:
  - 客户端密钥认证（服务器端验证）。
  - 基于角色的权限控制（例如，只有 SillyTavern 扩展可以创建/删除房间、生成/移除客户端密钥）。
  - SillyTavern 扩展密码登录 (可选)。
  - SillyTavern扩展登录密码自动哈希 (服务器启动时)。
- **房间管理**:
  - 支持创建、删除房间（仅限 SillyTavern 扩展）。
  - 支持将客户端添加到房间或从房间移除。
  - 支持获取房间列表和房间内的客户端列表。
  - 客户端断连自动重连, 重连失败自动删除房间。
- **Function Calling**:
  - 支持服务器端注册和调用自定义函数。
  - 支持 SillyTavern 扩展通过服务器调用已注册的函数。
  - 支持服务器调用SillyTavern扩展端注册的函数 (通过前端助手)。
- **消息路由**:
  - 支持基于消息类型、来源、目标和自定义规则的消息路由。
  - 支持向特定房间、特定客户端或所有客户端发送消息。
- **请求队列**:
  - SillyTavern 扩展端支持 LLM 请求和函数调用请求的排队处理，确保按顺序执行。
  - 服务器端不再需要请求队列。
- **即时流式转发**:
  - 支持服务器接收到 SillyTavern 扩展发送的每个 token 后，立即转发给客户端。
- **配置与自动加载**:
  - 支持从 UI 加载和保存服务器设置（如服务器地址、端口等）。
  - 支持从文件自动加载可信客户端和 SillyTavern 扩展列表。
- **多 SillyTavern 实例支持**:
  - 支持多个 SillyTavern 扩展实例连接到同一个服务器。
  - 每个 SillyTavern 扩展实例自动分配一个唯一的 clientId。
- **与SillyTavern深度集成**
  - 通过前端助手，实现了与SillyTavern的事件、消息、生成等功能的深度集成。
- **日志记录**:
  - 详细的日志记录，方便调试和问题排查。

## 未来计划 (Future Plans)

1. **增强安全性**:
    - 添加更严格的输入验证和防注入攻击措施。
    - 考虑使用 HTTPS 加密通信。

2. **优化性能**:
    - 进一步优化流式传输性能。
    - 优化消息处理和路由效率。

3. **扩展 API**:
    - 提供更丰富的 API，允许开发者更灵活地控制和扩展功能。

4. **UI 增强**:
    - 提供更友好的用户界面，方便配置和管理。
    - 实时显示连接状态、房间信息、客户端信息等。

5. **集成 SillyTavern**:
    - 与 SillyTavern 的事件系统更好地整合。
    - 提供更多与 SillyTavern 交互的功能 (例如，修改消息、切换角色等)。

6. **Function Calling优化**:
    - 扩展函数调用的功能, 允许服务器/客户端调用已注册的函数.

7. **文档完善**:
    - 补充和完善开发文档。

## 潜在用途 (Potential Use Cases)

- **聊天机器人**: 创建更智能、更具交互性的聊天机器人，可以与外部服务（如天气、新闻、知识库等）集成。
- **AI 辅助工具**: 集成 AI 写作、绘画、代码生成等工具，增强 SillyTavern 的创作能力。
- **游戏集成**: 将 SillyTavern 与游戏集成，实现角色扮演、剧情生成、游戏内聊天等功能。
- **数据分析**: 将 SillyTavern 的数据发送到外部服务器进行分析和可视化。
- **多用户协作**: 实现多个 SillyTavern 实例之间的协作，例如多人角色扮演、协同创作等。
- **自定义前端**: 创建自定义的 SillyTavern 前端界面，提供更丰富的功能和更好的用户体验。
- **SillyTavern 设置同步**: 通过服务器同步多个 SillyTavern 实例的设置。

## 使用方法 (How to Use)

1. **安装扩展：** 在 SillyTavern 中，转到 "Extensions" 面板，点击 "Load extension from URL"，输入本项目的 GitHub 仓库链接 (`https://github.com/HerSophia/SillyTavern-NewAge`)，然后点击 "LOAD"。
2. **启动服务器：**
    - **方法一 (推荐)：** 找到 SillyTavern-NewAge 扩展的根目录下的 `server` 文件夹 (通常在 `SillyTavern/public/scripts/extensions/third-party/SillyTavern-NewAge/server`)。
    - **方法二：** 如果你单独下载了 `server` 文件夹，则进入该文件夹。
    - 在该文件夹中打开命令行终端 (CMD 或 PowerShell)。
    - 运行命令 `node server.js` 启动服务器。
3. **连接：**
    - 刷新 SillyTavern 页面, 扩展应该会自动连接到服务器（默认地址为 `http://localhost:4000`）。
    - 如果自动连接失败，可以在扩展的设置界面手动输入服务器地址和端口，然后点击 "Connect"。

## 开发文档 (Documentation for Developers)

- [SillyTavern 扩展端开发文档](developer_readme_extension.md)
- [服务器端开发文档](developer_readme_server.md)

我们鼓励开发者基于此扩展进行二次开发，创建更多有趣和实用的功能。

## 鸣谢 (Acknowledgements)

- 感谢 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 团队提供的出色平台。
- 感谢 [Socket.IO](https://socket.io/) 团队开发的强大库。
- 感谢 [前端助手](https://github.com/N0VI028/JS-Slash-Runner) 团队的工作。

## 状态 (Status)

本项目仍处于 alpha 阶段。 欢迎社区的反馈、建议和贡献！
