/// <reference types="vite/client" />

interface DesktopVersions {
  readonly chrome: string;
  readonly electron: string;
  readonly node: string;
}

interface Window {
  readonly desktop: {
    readonly versions: () => DesktopVersions;
  };
}
