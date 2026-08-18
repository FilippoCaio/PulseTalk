/// <reference types="vite/client" />

import type { ApiPulseTalk } from '../../preload'

declare global {
  interface Window {
    // Esiste solo dentro Electron. Nel browser e' `undefined`, ed e' cosi' che
    // `ponte.ts` capisce dove sta girando.
    pulsetalk?: ApiPulseTalk
  }
}

export {}
