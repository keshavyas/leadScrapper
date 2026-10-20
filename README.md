# LeadScout

```
leadscout/
├── backend/   server.js, package.json   (Express + Playwright, port 5000)
└── frontend/  public/index.html, src/{index.js,App.js,App.css}  (React, port 3000)
```

## Run
```
cd backend  && npm install && npx playwright-chromium install chromium && npm start
cd frontend && npm install && npm start
```
Open http://localhost:3000 (the React dev proxy forwards /api to port 5000).
