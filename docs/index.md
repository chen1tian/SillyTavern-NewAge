---
layout: default
title: SillyTavern-NewAge
permalink: /
---

<div class="container">
  <div class="row align-items-center">
    <div class="col-md-6">
      <h1>SillyTavern-NewAge</h1>
      <p class="lead">
        基于 Socket.IO 的 SillyTavern 双向通信扩展，打破沙盒限制，连接无限可能。
      </p>
      <a href="{{ '/usage/' | relative_url }}" class="btn btn-primary btn-lg">使用说明</a>
      <a href="https://github.com/HerSophia/SillyTavern-NewAge" class="btn btn-secondary btn-lg" target="_blank" rel="noopener noreferrer">
        <i class="fab fa-github"></i> 在 GitHub 上查看
      </a>
    </div>
    <div class="col-md-6">
      <!-- Replace with your project logo -->
      <img src="{{ '/assets/images/logo.png' | relative_url }}" alt="SillyTavern-NewAge Logo" class="img-fluid">
    </div>
  </div>

  <!-- Swiper -->
  <div class="swiper-container mt-5">
    <div class="swiper-wrapper">
      <!-- Slide 1 -->
      <div class="swiper-slide">
        <div class="card">
          <div class="card-body">
            <i class="fas fa-exchange-alt fa-3x mb-3"></i>
            <h4 class="card-title">双向通信系统</h4>
            <p class="card-text">
              基于 Socket.IO，支持 SillyTavern 与服务器之间的稳定、可靠、安全的消息传递，支持流式和非流式传输。
            </p>
          </div>
        </div>
      </div>
      <!-- Slide 2 -->
      <div class="swiper-slide">
        <div class="card">
          <div class="card-body">
            <i class="fas fa-cogs fa-3x mb-3"></i>
            <h4 class="card-title">Function Calling</h4>
            <p class="card-text">
              支持服务器和 SillyTavern 扩展之间的函数调用，实现更强大的功能集成。
            </p>
          </div>
        </div>
      </div>
      <!-- Slide 3 -->
      <div class="swiper-slide">
        <div class="card">
          <div class="card-body">
            <i class="fas fa-shield-alt fa-3x mb-3"></i>
            <h4 class="card-title">安全与管理</h4>
            <p class="card-text">
              提供连接管理、安全认证、房间管理、消息路由等功能，保障通信安全可靠。
            </p>
          </div>
        </div>
      </div>
      <!-- Slide 4 -->
      <div class="swiper-slide">
        <div class="card">
          <div class="card-body">
            <i class="fas fa-arrows-alt fa-3x mb-3"></i>
            <h4 class="card-title">即时流式转发</h4>
            <p class="card-text">
              支持服务器接收到 SillyTavern 扩展发送的每个 token 后，立即转发给客户端。
            </p>
          </div>
        </div>
      </div>
      <!-- Slide 5 -->
      <div class="swiper-slide">
        <div class="card">
          <div class="card-body">
            <i class="fas fa-users fa-3x mb-3"></i>
            <h4 class="card-title">多实例支持</h4>
            <p class="card-text">
              支持多个SillyTavern实例连接, 自动分配唯一ID, 通过服务器同步多个 SillyTavern 实例的设置。
            </p>
          </div>
        </div>
      </div>
      <!-- Slide 6 -->
      <div class="swiper-slide">
        <div class="card">
          <div class="card-body">
            <i class="fas fa-link fa-3x mb-3"></i>
            <h4 class="card-title">深度集成</h4>
            <p class="card-text">
              通过前端助手与SillyTavern深度集成, 提供事件、消息、生成等功能。
            </p>
          </div>
        </div>
      </div>
    </div>
    <!-- Add Pagination -->
    <div class="swiper-pagination"></div>
  </div>
</div>

<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.3/css/all.min.css">