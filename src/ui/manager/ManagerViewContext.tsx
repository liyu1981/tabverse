import React, { useContext } from 'react';

import { Toaster } from '@blueprintjs/core';

export interface IManagerViewContext {
  toaster: Toaster;
}

export const ManagerViewContext = React.createContext<IManagerViewContext>({
  toaster: null,
});

export const ManagerViewContextProvider = ManagerViewContext.Provider;

export function ManagerViewContextSupport() {
  const managerViewContext = useContext(ManagerViewContext);
  return (
    <div>
      <Toaster
        ref={(ref: Toaster) => {
          managerViewContext.toaster = ref;
        }}
      />
    </div>
  );
}
