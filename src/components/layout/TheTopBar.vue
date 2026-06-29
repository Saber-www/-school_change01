<template>
  <header class="topbar">
    <button class="brand-button" id="brandButton" type="button" title="返回首页">
      <span class="brand-mark">集</span>
      <span>
        <strong>校园轻集市</strong>
        <small>Campus Light Market</small>
      </span>
    </button>

    <label class="search-box" for="globalSearch">
      <i data-lucide="search" aria-hidden="true"></i>
      <input
        id="globalSearch"
        type="search"
        placeholder="搜索教材、跑腿、失物、地点"
        autocomplete="off"
      />
    </label>

    <nav class="channel-nav" id="channelNav" aria-label="频道导航"></nav>

    <div class="top-actions">
      <button class="icon-button" id="messagesButton" type="button" title="消息中心">
        <i data-lucide="message-circle" aria-hidden="true"></i>
      </button>
      <button class="primary-button" id="publishButton" type="button">
        <i data-lucide="plus" aria-hidden="true"></i>
        发布
      </button>
      <button class="ghost-button" id="userButton" type="button"></button>
    </div>
  </header>
</template>
