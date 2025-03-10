document.addEventListener('DOMContentLoaded', function () {
  const cards = document.querySelectorAll('.card');
  let currentCardIndex = 0;
  let intervalId;

  function showCard(index) {
    cards.forEach((card, i) => {
      if (i === index) {
        card.style.display = 'block';
        // 触发 CSS 过渡效果
        setTimeout(() => {
          card.classList.add('active');
        }, 10); // 稍作延迟，确保 display: block 生效
      } else {
        card.classList.remove('active');
        // 隐藏卡片之前，先移除 'active' 类，以便下次显示时可以重新触发过渡
        card.style.display = 'none';
      }
    });
  }

  function nextCard() {
    currentCardIndex = (currentCardIndex + 1) % cards.length;
    showCard(currentCardIndex);
  }

  function startAutoSwitch(interval = 5000) { // 默认 5 秒切换一次
    intervalId = setInterval(nextCard, interval);
  }

  function stopAutoSwitch() {
    clearInterval(intervalId);
  }

  // 初始显示第一张卡片
  showCard(currentCardIndex);

  // 启动自动切换
  startAutoSwitch();

  // 鼠标悬停在卡片上时暂停自动切换，移开时恢复
  const cardContainer = document.querySelector('.row.mt-5'); // 假设卡片都在这个容器内
  if (cardContainer) {
    cardContainer.addEventListener('mouseover', stopAutoSwitch);
    cardContainer.addEventListener('mouseout', startAutoSwitch);
  }

});