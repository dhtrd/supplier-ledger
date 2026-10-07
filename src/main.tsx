import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/noto-naskh-arabic/700.css';
import './styles/global.css';
import { App } from './core/App';
import { finishPendingWipe } from './core/firebase';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// A sign-out in another tab may have left the device cache to wipe.
void finishPendingWipe().finally(() =>
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
