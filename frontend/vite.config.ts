import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import {resolve} from 'node:path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // 👈 Electron에서 파일을 올바르게 로드하기 위해 필수입니다!
  resolve: {
    // Official plugin sources live outside frontend/, so pin shared runtime deps.
    alias: {
      react: resolve(__dirname, 'node_modules/react'),
      'react/jsx-runtime': resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
      'lucide-react': resolve(__dirname, 'node_modules/lucide-react'),
      'react-i18next': resolve(__dirname, 'node_modules/react-i18next'),
      'react-player': resolve(__dirname, 'node_modules/react-player'),
    },
  },
  build: {
    outDir: '../app/static', // 👈 빌드 결과물이 저장될 위치
    emptyOutDir: true,       // 👈 빌드할 때마다 기존 폴더를 비우고 새로 생성
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {name: 'editor', test: /node_modules\/(?:@tiptap|tiptap-markdown|prosemirror)/},
            {name: 'document-viewers', test: /node_modules\/(?:docx-preview|katex|marked|highlight\.js|lowlight)/},
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      // /api로 시작하는 모든 요청을 Backend로 프록시
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      }
    }
  }
})
