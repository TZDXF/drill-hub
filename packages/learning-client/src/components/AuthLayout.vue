<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import AppIcon from '#learning-client/components/AppIcon.vue';

const { t } = useI18n();
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
        <h2 style="white-space: pre-line">{{ t('components.auth.headline') }}</h2>
        <p>{{ t('components.auth.description') }}</p>
      </div>
      <span class="auth-footnote">{{ t('components.auth.footnote') }}</span>
    </aside>
    <main class="auth-main">
      <section class="auth-card" aria-labelledby="auth-title">
        <slot name="back" />
        <h1 id="auth-title">{{ title }}</h1>
        <p>{{ description }}</p>
        <slot />
      </section>
    </main>
  </div>
</template>
