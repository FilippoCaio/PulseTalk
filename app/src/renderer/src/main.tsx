import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Problemi from './Problemi'
import Rete from './Rete'
import { Diagnostica } from './lib/diagnostica'
import './index.css'

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
