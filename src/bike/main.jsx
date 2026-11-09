import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import BikeApp from './BikeApp.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import '../index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BikeApp />
    </ErrorBoundary>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { scope: './' }));
}
