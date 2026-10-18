import { createLearningApp } from '@drill-hub/learning-client';
import { webPlatform } from './platform';

createLearningApp({ platform: webPlatform }).mount('#app');
