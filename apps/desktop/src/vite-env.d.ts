/// <reference types="vite/client" />
import type { DesktopApi } from "./model";

declare global {
  interface Window {
    readonly desktop?: DesktopApi;
  }
}
