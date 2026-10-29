import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useLearning } from '#learning-client/injection';

export function useMobileLayout() {
  const { platform } = useLearning();
  const query = typeof window === 'undefined' ? null : window.matchMedia('(max-width: 780px)');
  const isMobile = ref(platform.kind === 'android' || (query?.matches ?? false));
  const sync = () => {
    isMobile.value = platform.kind === 'android' || (query?.matches ?? false);
  };

  onMounted(() => {
    query?.addEventListener('change', sync);
    sync();
  });
  onBeforeUnmount(() => query?.removeEventListener('change', sync));

  return isMobile;
}
