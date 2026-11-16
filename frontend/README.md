# HIP frontend

The React web app for the Hospital Intelligence Platform. Setup, architecture and testing for the whole project are in
the [root README](../README.md).

Run these commands from this folder with Node.js 22.13 or later, or 24. The dev server proxies API and WebSocket calls
to nginx on http://localhost:8080, so start the backend stack first.

```bash
npm ci            # install dependencies
npm run dev       # dev server on http://localhost:3000
npm test          # Vitest suite, including the jest-axe accessibility tests
npm run lint      # ESLint
npm run build     # type-check and build into dist/
npm run preview   # serve the production build locally
```

If port 3000 is taken, use `npm run dev -- --port 3001` and add that origin to `CORS_ORIGINS` and `FRONTEND_URL`
in the root `.env`.
