import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Problemi from './Problemi'
import Rete from './Rete'
import { Diagnostica } from './lib/diagnostica'
import { applicaTemaSalvato } from './lib/tema'
import './index.css'

// I colori di ieri, rimessi su prima che React disegni qualcosa. Le
// impostazioni vere arrivano da un giro asincrono, e fino ad allora l'app
// sarebbe dipinta con quelli di serie: su un tema chiaro sono due decimi di
// nero a tutto schermo, a ogni apertura.
applicaTemaSalvato()

createRoot(document.getElementById('radice')!).render(
  <StrictMode>
    <Rete>
      <Diagnostica>
        <App />
        <Problemi />
      </Diagnostica>
    </Rete>
  </StrictMode>
)
