import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AnnouncerProvider } from './components/a11y/Announcer'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AnnouncerProvider>
      <App />
    </AnnouncerProvider>
  </StrictMode>,
)
