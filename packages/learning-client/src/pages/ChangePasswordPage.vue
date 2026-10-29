<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useLearning } from '#learning-client/injection';
import AuthLayout from '#learning-client/components/AuthLayout.vue';
import AppIcon from '#learning-client/components/AppIcon.vue';
import ChangePasswordForm from '#learning-client/components/ChangePasswordForm.vue';

const { t } = useI18n();
const learning = useLearning();
</script>

<template>
  <AuthLayout
    :title="t('management.password.title')"
    :description="t('management.password.description')"
  >
    <template #back>
      <RouterLink
        v-if="!learning.state.user?.mustChangePassword"
        class="back-link"
        :to="{ name: 'settings' }"
      >
        <AppIcon name="back" :size="16" />{{ t('management.password.back') }}
      </RouterLink>
    </template>

    <ChangePasswordForm />
  </AuthLayout>
</template>
