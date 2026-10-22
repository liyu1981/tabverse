import React, { useState } from 'react';

import { LoadStatus } from '../../global';
import { t } from '../../i18n';
import { useAsyncEffect } from './useAsyncEffect';

export function getLoadingComponent2<T extends React.FC<any>>(
  component: T,
  loader: () => Promise<void>,
) {
  function WrappedComponent(props) {
    const [loadStatus, setLoadStatus] = useState<LoadStatus>(
      LoadStatus.Loading,
    );

    useAsyncEffect(async () => {
      setLoadStatus(LoadStatus.Loading);
      const _result = await loader();
      setLoadStatus(LoadStatus.Done);
    }, []);

    return loadStatus === LoadStatus.Done ? (
      <div>{React.createElement(component, props)}</div>
    ) : (
      <div>{t('commonLoading')}</div>
    );
  }
  return WrappedComponent;
}
