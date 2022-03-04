import React, { useState } from 'react';

import { LoadStatus } from '../../global';
import { useAsyncEffect } from './useAsyncEffect';

export function getLoadingComponent(
  component: React.FC<any>,
  loader: () => Promise<any>,
  destProp: string,
): React.FC {
  function wrappedComponent() {
    const [loadStatus, setLoadStatus] = useState<LoadStatus>(
      LoadStatus.Loading,
    );
    const [propsData, setPropsData] = useState(null);

    useAsyncEffect(async () => {
      setLoadStatus(LoadStatus.Loading);
      const result = await loader();
      const props = {};
      props[destProp] = result;
      setPropsData(props);
      setLoadStatus(LoadStatus.Done);
    }, []);

    return loadStatus === LoadStatus.Done ? (
      <div>{React.createElement(component, propsData)}</div>
    ) : (
      <div>Loading...</div>
    );
  }
  return wrappedComponent;
}
