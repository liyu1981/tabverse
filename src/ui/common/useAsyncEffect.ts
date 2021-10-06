import { useEffect } from 'react';

export const useAsyncEffect = <T>(
  effectFn: () => Promise<T>,
  depends: any[] = [],
) => {
  useEffect(() => {
    async function effectImpl() {
      await effectFn();
    }
    effectImpl();
  }, depends);
};
