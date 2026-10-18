import { inject, type InjectionKey } from 'vue';
import type { LearningContext } from './context';

export const learningContextKey: InjectionKey<LearningContext> = Symbol('learning-context');

export function useLearning(): LearningContext {
  const context = inject(learningContextKey);
  if (!context) throw new Error('Learning context is not available');
  return context;
}
