import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * La rete sotto all'interfaccia.
 *
 * React, davanti a un errore durante il disegno, smonta tutto l'albero e
 * lascia una pagina vuota. Dentro a una finestra di Electron quella pagina
 * vuota e' indistinguibile da un'applicazione che non parte: nessun messaggio,
 * nessuna console aperta, niente da riferire se non "non compare nulla".
 *
 * Questo componente intercetta l'errore e lo mostra, con il testo che si puo'
 * copiare. Non ripara niente — non e' il suo mestiere — ma trasforma un
 * guasto muto in un guasto che si puo' raccontare.
 *
 * E' una classe perche' e' l'unico modo: i confini d'errore in React non
 * esistono come hook.
 */
export default class Rete extends Component<
  { children: ReactNode },
  { errore: Error | null; dove: string | null }
> {
  state: { errore: Error | null; dove: string | null } = { errore: null, dove: null }

  static getDerivedStateFromError(errore: Error): { errore: Error; dove: null } {
    return { errore, dove: null }
  }

  componentDidCatch(errore: Error, info: ErrorInfo): void {
    this.setState({ errore, dove: info.componentStack ?? null })
    // Anche in console: chi ha gli strumenti aperti se lo trova li', e in
    // pacchetto finisce nel log di Chromium con --enable-logging.
    console.error('Errore durante il disegno:', errore, info.componentStack)
  }

  render(): ReactNode {
    const { errore, dove } = this.state
    if (!errore) return this.props.children

    const rapporto = [
      errore.message,
      '',
      errore.stack ?? '(nessuna pila)',
      '',
      dove ?? '(nessun componente)'
    ].join('\n')

    return (
      <div className="flex h-full items-center justify-center bg-fondo p-8">
        <div className="w-full max-w-2xl space-y-4">
          <div>
            <h1 className="text-lg font-semibold text-testo">PulseTalk si e' fermata.</h1>
            <p className="mt-1 text-sm text-testo-2">
              Qualcosa e' andato storto mentre disegnava l'interfaccia. Qui sotto c'e' cosa, e si
              puo' copiare.
            </p>
          </div>

          <pre className="max-h-72 overflow-auto rounded-lg border border-bordo bg-fondo-2 p-3 text-xs whitespace-pre-wrap text-testo-2">
            {rapporto}
          </pre>

          <div className="flex gap-2">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-vivo px-3 py-1.5 text-sm font-medium text-fondo"
            >
              Riprova
            </button>
            <button
              onClick={() => void navigator.clipboard.writeText(rapporto)}
              className="rounded-lg border border-bordo px-3 py-1.5 text-sm text-testo-2 hover:text-testo"
            >
              Copia il rapporto
            </button>
          </div>
        </div>
      </div>
    )
  }
}
