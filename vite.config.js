import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative base so the same build works at a domain root or a sub-path (e.g. GitHub Pages /ridewx/).
  base: './',
  // Geolocation, microphone, Wake Lock and Service Workers all require a secure
  // context. localhost counts as secure; for testing on a phone over LAN use
  // `vite --host` behind an HTTPS tunnel, or deploy to any static HTTPS host.
  server: { port: 5173 },
  // Two apps, one build: RideWX (index.html) and RideWX Watt for cycling (bike.html).
  build: { rollupOptions: { input: { main: 'index.html', bike: 'bike.html' } } },
});
