// example/LLM_Role_Play/js/App.js

import React, { useState, useEffect } from 'react';
import {
  Container, Header, Main, Footer, ButtonGroup, StyledButton,
  ChatOutput, Message, MessageAvatar, MessageContent, MessageHeader,
  MessageName, MessageDate, MessageText, UserMessage, LLMMessage,
  InputArea, UserInput, SendButton, Modal, ModalContent, CloseButton
} from './style.js';
import * as settings from "./settings.js";
import * as ui from './ui.js';
import { updateUIText } from './settings.js';

// 假设的组件，你需要根据你的实际需求来实现
function ChatSettingsModal({ isOpen, onClose }) {
  // ... (聊天设置模态框的内容) ...
  if (!isOpen) return null;
  return (
    <Modal>
      <ModalContent>
        <CloseButton onClick={onClose}>×</CloseButton>
        <h2 data-i18n="chat_settings">Chat Settings</h2>
        {/*  模态框内容  */}
      </ModalContent>
    </Modal>
  );
}

function ChatHistoryModal({ isOpen, onClose }) {
  // ... (聊天记录模态框的内容) ...
  if (!isOpen) return null;

  return (
    <Modal>
      <ModalContent>
        <CloseButton onClick={onClose}>×</CloseButton>
        <h2 data-i18n="chat_history">Chat History</h2>
        {/*  模态框内容  */}
      </ModalContent>
    </Modal>
  )
}

function SystemSettingsModal({ isOpen, onClose }) {
  if (!isOpen) return null;
  return (
    <Modal>
      <ModalContent>
        <CloseButton onClick={onClose}>×</CloseButton>
        <h2 data-i18n="system_settings_modal.system_settings">System Settings</h2>
        {/*  系统设置内容  */}
      </ModalContent>
    </Modal>
  );
}

function PageSettingsModal({ isOpen, onClose }) {
  if (!isOpen) return null;
  return (
    <Modal>
      <ModalContent>
        <CloseButton onClick={onClose}>×</CloseButton>
        <h2 data-i18n="page_settings_modal.page_settings">Page Settings</h2>
        {/*  页面设置内容  */}
      </ModalContent>
    </Modal>
  );
}

function CharacterSelectModal({ isOpen, onClose }) {
  if (!isOpen) return null;
  return (
    <Modal >
      <ModalContent>
        <CloseButton onClick={onClose}>×</CloseButton>
        <h2 data-i18n="character_select">Character Select</h2>
        {/* 角色选择内容  */}
      </ModalContent>
    </Modal>
  );
}

function App() {
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const [systemSettingsOpen, setSystemSettingsOpen] = useState(false);
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false);
  const [characterSelectOpen, setCharacterSelectOpen] = useState(false);

  // 使用 useEffect 来在组件挂载后更新 UI 文本
  useEffect(() => {
    updateUIText();
    ui.setupModalOpenCloseHandlers();
    ui.initModalControls(); // 确保你的初始化函数仍然被调用
  }, []); // 空依赖数组表示这个 effect 只在组件挂载后运行一次

  return (
    <Container>
      <Header>
        <ButtonGroup>
          <StyledButton onClick={() => setChatSettingsOpen(true)} data-i18n="chat_settings" data-i18n-title="chat_settings">
            <i className="fas fa-comments"></i>
            <span data-i18n="chat_settings">Chat Settings</span>
          </StyledButton>
          <StyledButton onClick={() => setChatHistoryOpen(true)} data-i18n="chat_history" data-i18n-title="chat_history">
            <i className="fas fa-history"></i>
            <span data-i18n="chat_history">Chat History</span>
          </StyledButton>
          <StyledButton onClick={() => setSystemSettingsOpen(true)} data-i18n="system_settings" data-i18n-title="system_settings">
            <i className="fas fa-cog"></i>
            <span data-i18n="system_settings">System Settings</span>
          </StyledButton>
          <StyledButton onClick={() => setPageSettingsOpen(true)} data-i18n="page_settings" data-i18n-title="page_settings">
            <i className="fas fa-palette"></i>
            <span data-i18n="page_settings">Page Settings</span>
          </StyledButton>
          <StyledButton onClick={() => setCharacterSelectOpen(true)} data-i18n-title="character_select">
            <i className="fas fa-user-friends"></i>
            <span data-i18n="character_select">Character Select</span>
          </StyledButton>
        </ButtonGroup>
        <h1 data-i18n="app_title">LLM Role Play</h1>
      </Header>
      <Main>
        <ChatOutput id="chat-output">
          {/* 动态添加消息 */}
        </ChatOutput>
      </Main>
      <Footer>
        <InputArea>
          <UserInput id="user-input" data-i18n-placeholder="enter_message" data-i18n-title="enter_message"
            placeholder="Enter your message..."></UserInput>
          <SendButton id="send-button" data-i18n-title="send">
            <i className="fas fa-paper-plane"></i>
            <span data-i18n="send">Send</span>
          </SendButton>
        </InputArea>
      </Footer>

      {/* 模态框 */}
      <ChatSettingsModal isOpen={chatSettingsOpen} onClose={() => setChatSettingsOpen(false)} />
      <ChatHistoryModal isOpen={chatHistoryOpen} onClose={() => setChatHistoryOpen(false)} />
      <SystemSettingsModal isOpen={systemSettingsOpen} onClose={() => setSystemSettingsOpen(false)} />
      <PageSettingsModal isOpen={pageSettingsOpen} onClose={() => setPageSettingsOpen(false)} />
      <CharacterSelectModal isOpen={characterSelectOpen} onClose={() => setCharacterSelectOpen(false)} />
    </Container>
  );
}

export default App;