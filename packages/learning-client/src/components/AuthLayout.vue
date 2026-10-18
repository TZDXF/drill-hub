<script setup lang="ts">
import AppIcon from './AppIcon.vue';
defineProps<{ title: string; description: string }>();
</script>

<template>
  <div class="auth-layout">
    <aside class="auth-aside">
      <div class="auth-brand">
        <span class="brand-mark"><AppIcon name="book" /></span><strong>Drill Hub</strong>
      </div>
      <div class="auth-message">
        <span class="eyebrow">PERSONAL LEARNING WORKSPACE</span>
        <h1>把目标拆成计划，<br />让每次练习都有回应。</h1>
        <p>内容、作答与评分记录安全保存在你的学习服务器。专注于理解，而不是管理工具。</p>
      </div>
      <span class="auth-footnote">纯文本学习 · 服务端评分 · 个人数据隔离</span>
    </aside>
    <main class="auth-main">
      <section class="auth-card" aria-labelledby="auth-title">
        <slot name="back" />
        <h2 id="auth-title">{{ title }}</h2>
        <p>{{ description }}</p>
        <slot />
      </section>
    </main>
  </div>
</template>
