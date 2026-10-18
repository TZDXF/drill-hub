import { createLearningApp } from '@drill-hub/learning-client';
import '@drill-hub/learning-client/style.css';

import { androidPlatform } from './platform';

const app = createLearningApp({ platform: androidPlatform });

app.mount('#app');
