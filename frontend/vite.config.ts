import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
const Backend_URL = 'http://localhost:8080'
export default defineConfig({

  plugins:[react(),tailwindcss()],
  server:{
    port:3000,
    host:true,
    proxy:{
      '/auth':{
        target:Backend_URL,
        changeOrigin:true,
      },
      '/patients':{
        target:Backend_URL,
        changeOrigin:true,
      },
      '/beds':{
        target:Backend_URL,
        changeOrigin:true,
      },
      '/ws':{
        target:Backend_URL,
        changeOrigin:true,
        ws:true,
      }
    }  

}
}
)
