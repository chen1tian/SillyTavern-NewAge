document.addEventListener('DOMContentLoaded', function () {
  var mySwiper = new Swiper('.swiper-container', {
    // Optional parameters
    loop: true, // 循环模式
    slidesPerView: 3, // 同时显示3个slide
    spaceBetween: 30, // slide之间的距离
    centeredSlides: true, // 居中显示
    pagination: {
      el: '.swiper-pagination',
      clickable: true, // 允许点击分页器切换
    },
    breakpoints: {
      // when window width is >= 320px
      320: {
        slidesPerView: 1,
        spaceBetween: 20
      },
      // when window width is >= 768px
      768: {
        slidesPerView: 2,
        spaceBetween: 30
      },
      // when window width is >= 992px
      992: {
        slidesPerView: 3,
        spaceBetween: 40
      }
    }

  });
});