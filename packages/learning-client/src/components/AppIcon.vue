<script setup lang="ts">
import { computed } from 'vue';
import { Icon, type IconifyIcon } from '@iconify/vue/offline';
import archive from '@iconify-icons/lucide/archive';
import arrowLeft from '@iconify-icons/lucide/arrow-left';
import arrowRight from '@iconify-icons/lucide/arrow-right';
import book from '@iconify-icons/lucide/book';
import calendarCheck from '@iconify-icons/lucide/calendar-check';
import calendarDays from '@iconify-icons/lucide/calendar-days';
import check from '@iconify-icons/lucide/check';
import chevronDown from '@iconify-icons/lucide/chevron-down';
import chevronRight from '@iconify-icons/lucide/chevron-right';
import clock from '@iconify-icons/lucide/clock';
import ellipsis from '@iconify-icons/lucide/ellipsis';
import eye from '@iconify-icons/lucide/eye';
import eyeOff from '@iconify-icons/lucide/eye-off';
import fileKey from '@iconify-icons/lucide/file-key';
import fileText from '@iconify-icons/lucide/file-text';
import fileX from '@iconify-icons/lucide/file-x';
import flag from '@iconify-icons/lucide/flag';
import history from '@iconify-icons/lucide/history';
import home from '@iconify-icons/lucide/home';
import chartColumn from '@iconify-icons/lucide/chart-column';
import lock from '@iconify-icons/lucide/lock';
import logOut from '@iconify-icons/lucide/log-out';
import monitor from '@iconify-icons/lucide/monitor';
import moon from '@iconify-icons/lucide/moon';
import plus from '@iconify-icons/lucide/plus';
import refreshCw from '@iconify-icons/lucide/refresh-cw';
import save from '@iconify-icons/lucide/save';
import server from '@iconify-icons/lucide/server';
import settings from '@iconify-icons/lucide/settings';
import sun from '@iconify-icons/lucide/sun';
import target from '@iconify-icons/lucide/target';
import triangleAlert from '@iconify-icons/lucide/triangle-alert';
import user from '@iconify-icons/lucide/user';
import users from '@iconify-icons/lucide/users';
import x from '@iconify-icons/lucide/x';

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 });

const icons: Record<string, IconifyIcon> = {
  book,
  usage: chartColumn,
  home,
  topics: calendarDays,
  wrong: fileX,
  user,
  history,
  flag,
  archive,
  settings,
  chevron: chevronRight,
  down: chevronDown,
  logout: logOut,
  plus,
  arrow: arrowRight,
  back: arrowLeft,
  check,
  clock,
  alert: triangleAlert,
  server,
  close: x,
  more: ellipsis,
  token: fileKey,
  users,
  model: monitor,
  refresh: refreshCw,
  target,
  content: fileText,
  plan: calendarCheck,
  lock,
  save,
  eye,
  'eye-off': eyeOff,
  sun,
  moon,
  system: monitor,
};

const icon = computed(() => icons[props.name] ?? icons.book);
</script>

<template>
  <Icon :icon="icon" :width="size" :height="size" aria-hidden="true" class="app-icon" />
</template>
