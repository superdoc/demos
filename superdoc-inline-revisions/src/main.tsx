import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SuperDocUIProvider } from 'superdoc/ui/react';
import App from './demo/App';
import 'superdoc/style.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SuperDocUIProvider>
      <App />
    </SuperDocUIProvider>
  </StrictMode>,
);
