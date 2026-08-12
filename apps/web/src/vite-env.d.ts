/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 배포된 apps/server(Cloudflare Workers)의 base URL. 비어 있으면 온라인 대전이 비활성화된다. */
  readonly VITE_API_BASE_URL?: string;
}
