import './assets/base.css'
import './assets/global.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initializeFontSize } from './settings/fontSize'

const disposeFontSize = initializeFontSize()
if (import.meta.hot) import.meta.hot.dispose(disposeFontSize)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
