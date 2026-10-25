import { createLearningApp } from '@drill-hub/learning-client';
import { webPlatform } from '#web/platform';

createLearningApp({ platform: webPlatform }).mount('#app');
