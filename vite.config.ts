import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' zodat de build werkt in een submap op GitHub Pages
export default defineConfig({ base: './', plugins: [react()] });
