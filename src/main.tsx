import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initTheme } from '@ui';
import App from './App';
import './styles/index.css';

initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
