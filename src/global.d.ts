import type { PdvApi } from '@shared/ipc'

declare global {
  interface Window {
    api: PdvApi
  }
}

export {}
