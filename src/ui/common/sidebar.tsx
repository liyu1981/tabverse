import * as React from 'react';

import { merge, slice } from 'lodash';

import { Colors } from '@blueprintjs/core';

function createStyles(props): { [k: string]: React.CSSProperties } {
  const defaultCustomStyle = {
    transition: '0.5s',
    sidebarMaxWidth: '320px',
    sidebarMinWidth: '210px',
    sidebarBase: {
      backgroundColor: Colors.GRAY1,
    },
  };
  return {
    sidebarBase: {
      height: '100%',
      position: 'fixed',
      zIndex: 1,
      top: 0,
      left: -1,
      backgroundColor:
        props?.customStyle?.sidebarBase?.backgroundColor ??
        defaultCustomStyle.sidebarBase.backgroundColor,
      overflowX: 'hidden',
      transition:
        props?.customStyle?.transition ?? defaultCustomStyle.transition,
      boxShadow: '0px 0px 2px #aaa',
      borderLeft: '1px solid #efefef',
      paddingLeft: '12px',
      paddingRight: '12px',
      paddingTop: '12px',
      paddingBottom: '12px',
    },
    sidebarCollapsed: {
      width:
        props?.customStyle?.sidebarMinWidth ??
        defaultCustomStyle.sidebarMinWidth,
    },
    sidebarNormal: {
      width:
        props?.customStyle?.sidebarMaxWith ??
        defaultCustomStyle.sidebarMaxWidth,
    },
    contentContainerBase: {
      paddingLeft: '20px',
      paddingRight: '20px',
      transition:
        props?.customStyle?.transition ?? defaultCustomStyle.transition,
    },
    contentContainerShift: {
      marginLeft:
        props?.customStyle?.sidebarMaxWith ??
        defaultCustomStyle.sidebarMaxWidth,
    },
    contentContainerNormal: {
      marginLeft:
        props?.customStyle?.sidebarMinWidth ??
        defaultCustomStyle.sidebarMinWidth,
    },
  };
}

const Sidebar = (props) => {
  const styles = createStyles(props);
  return (
    <div
      style={
        merge(
          styles.sidebarBase,
          props.collapsed ? styles.sidebarCollapsed : styles.sidebarNormal,
        ) as React.CSSProperties
      }
    >
      {props.children}
    </div>
  );
};

export const SidebarContainer = (props) => {
  const styles = createStyles(props);
  const sidebarContent = props.children[0];
  const contentChildren = slice(props.children, 1);
  return (
    <div>
      <Sidebar collapsed={props.sidebarCollapsed}>{sidebarContent}</Sidebar>
      <div
        style={merge(
          styles.contentContainerBase,
          props.sidebarCollapsed
            ? styles.contentContainerNormal
            : styles.contentContainerShift,
        )}
      >
        {contentChildren}
      </div>
    </div>
  );
};
