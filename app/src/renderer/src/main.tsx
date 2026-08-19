import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Rete from './Rete'
import './index.css'

createRoot(document.getElementById('radice')!).render(
  <StrictMode>
    <Rete>
      <App />
    </Rete>
  </StrictMode>
)
