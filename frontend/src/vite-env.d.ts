/// <reference types="vite/client" />

declare module '*.jsx' {
  import React from 'react';
  const component: React.ComponentType<any>;
  export default component;
  export const AppNav: React.ComponentType<any>;
  export const EtaTrack: React.ComponentType<any>;
}

declare module '../../dashboard/CommandCenter' {
  import React from 'react';
  const CommandCenter: React.ComponentType<{
    user?: any;
    onLogout?: () => void;
  }>;
  export default CommandCenter;
}
