import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PopupView } from './PopupView.tsx'

// Desktop popup windows load this same bundle with ?popup=1 and render just the
// floating visual instead of the full dashboard. Make the page transparent so
// only the glass panel shows over the desktop.
const params = new URLSearchParams(location.search)
const isPopup = params.has('popup')
const isOrb = params.has('orb')
if (isPopup || isOrb) {
  // In the Electron app the orb window is transparent (floats over your desktop).
  // In a plain browser (Raspberry Pi kiosk) there's nothing behind it, so give
  // the orb a dark high-tech backdrop so the brain glows on screen.
  const inElectron = Boolean((window as { chanceDesktop?: unknown }).chanceDesktop)
  const bg = isOrb && !inElectron
    ? 'radial-gradient(circle at 50% 42%, #0a1730 0%, #060a14 60%, #03050b 100%)'
    : 'transparent'
  document.documentElement.style.background = bg
  document.body.style.background = bg
  const root = document.getElementById('root')
  if (root) root.style.background = 'transparent'
}

createRoot(document.getElementById('root')!).render(
  isPopup ? <PopupView /> : (
    <StrictMode>
      <App />
    </StrictMode>
  ),
)
