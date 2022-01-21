import * as React from 'react';

import { LoadStatus } from '../../global';
import { useAsyncEffect } from './useAsyncEffect';
import { useState } from 'react';

export function getLoadingComponent(
  component: React.FC<any>,
  loader: () => Promise<any>,
  destProp: string,
) {
  function wrappedComponent() {
    const [loadStatus, setLoadStatus] = useState<LoadStatus>(
      LoadStatus.Loading,
    );
    const [propsData, setPropsData] = useState(null);

    useAsyncEffect(async () => {
      setLoadStatus(LoadStatus.Loading);
      const result = await loader();
      console.log('loaded:', result);
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
