import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const entries = [
  // 1. Popup UI (React app)
  {
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          popup: resolve(process.cwd(), 'index.html'),
        },
      },
    },
  },
  // 2. Background Service Worker
  {
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(process.cwd(), 'src/background/background.ts'),
        name: 'background',
        formats: ['es'],
        fileName: () => 'background.js',
      },
    },
  },
  // 3. Extractor Content Script
  {
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(process.cwd(), 'src/content/extractor.ts'),
        name: 'extractor',
        formats: ['iife'], // IIFE encapsulates all code without external imports
        fileName: () => 'content/extractor.js',
      },
    },
  },
  // 4. Injector Content Script
  {
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(process.cwd(), 'src/content/injector.ts'),
        name: 'injector',
        formats: ['iife'], // IIFE encapsulates all code without external imports
        fileName: () => 'content/injector.js',
      },
    },
  },
  // 5. Network Hook
  {
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(process.cwd(), 'src/content/networkHook.ts'),
        name: 'networkHook',
        formats: ['iife'],
        fileName: () => 'content/networkHook.js',
      },
    },
  },
];

async function run() {
  console.log('Starting sequential extension build...');
  for (const config of entries) {
    const entryName = config.build.lib ? config.build.lib.name : 'popup';
    console.log(`Building entry: ${entryName}...`);
    await build(config);
  }
  console.log('Build completed successfully! Unpacked extension is ready in the "dist" directory.');
}

run().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
