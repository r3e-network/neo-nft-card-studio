#!/bin/bash
lsof -ti:5173 | xargs kill -9 2>/dev/null
lsof -ti:8080 | xargs kill -9 2>/dev/null
npm run dev:api > api.log 2>&1 &
API_PID=$!
npm run dev:web > web.log 2>&1 &
WEB_PID=$!
sleep 10
node tests/wif-ui.mjs
RES=$?
kill $API_PID
kill $WEB_PID
exit $RES
