import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function serverPredefinito(): string {
  if (process.env.PULSETALK_SERVER) return process.env.PULSETALK_SERVER.trim()
  const file = resolve('server.local')
  if (!existsSync(file)) return ''
  return (
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((riga) => riga.trim())
      .find((riga) => riga && !riga.startsWith('#')) ?? ''
  )
}

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  base: './',
  define: {
    __SERVER_PREDEFINITO__: JSON.stringify(serverPredefinito())
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@': resolve(import.meta.dirname, 'src/renderer/src')
    }
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist/android'),
    emptyOutDir: true,
    target: 'es2022'
  }
})
