/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POSTHOG_KEY?: string; // analytics is on only when both are set at build time and the viewer accepted
  readonly VITE_POSTHOG_HOST?: string;
}
