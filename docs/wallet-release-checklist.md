# Wallet Release Checklist

Use this checklist before shipping wallet-related frontend changes.

Primary implementation references:

- [apps/web/src/lib/neoline.ts](/Users/jinghuiliao/git/NFT/apps/web/src/lib/neoline.ts)
- [apps/web/src/hooks/useWallet.tsx](/Users/jinghuiliao/git/NFT/apps/web/src/hooks/useWallet.tsx)
- [tests/wif-ui.mjs](/Users/jinghuiliao/git/NFT/tests/wif-ui.mjs)
- [docs/neoline-frontend-integration.md](/Users/jinghuiliao/git/NFT/docs/neoline-frontend-integration.md)

## 1. Preconditions

- `NEO_TEST_WIF` is set to a valid Neo N3 testnet WIF.
- Ports `5173` and `8080` are free if you run the local WIF UI flow.
- If wallet diagnostics are needed, set `VITE_WALLET_DEBUG=true` in the frontend environment.

## 2. Required Local Checks

Run all of these:

```bash
npm run check
npm run build
npm run smoke:trade
npm run smoke:e2e
NEO_TEST_WIF=... npm run test:wif-ui
```

Expected result:

- all commands exit `0`
- no repeated wallet connect popups
- no `Wallet session is unavailable` error during action pages
- no reconnect flow when moving between pages after a successful connect

## 3. Manual Browser Checks

Verify all of the following in a real browser with the target wallet extension installed:

1. Open home page and click `Connect`.
2. Approve the wallet once.
3. Confirm header changes from `Connect` to short wallet address.
4. Navigate to `Create`.
5. Confirm wallet stays connected before any submit.
6. Submit `Launch Collection`.
7. Confirm a transaction/signature flow appears, not a reconnect flow.
8. Navigate to `Mint`.
9. Confirm wallet is still connected.
10. Navigate to `Explore`.
11. Confirm wallet is still connected.
12. Open `/portfolio` directly.
13. Confirm wallet is still connected.
14. Refresh the page on `/portfolio`.
15. Confirm connected UI is restored.

## 4. Manual Failure Checks

Verify these negative paths too:

1. No wallet installed:
   - UI shows a clear install/connect failure
2. Wallet popup closed or denied:
   - connect exits cleanly
   - button returns from `Connecting...`
3. Wallet method hangs:
   - connect eventually exits instead of spinning forever

## 5. Production Deployment Checks

After deployment:

1. Confirm the deployed commit hash is the expected one.
2. Open production site in a clean tab.
3. Run the same connect -> create -> mint -> explore -> portfolio -> refresh path manually.
4. If wallet behavior differs from local:
   - enable `VITE_WALLET_DEBUG=true`
   - inspect `[wallet-debug]` console entries

## 6. Troubleshooting Shortcuts

If wallet bugs reappear:

- Read [docs/neoline-frontend-integration.md](/Users/jinghuiliao/git/NFT/docs/neoline-frontend-integration.md)
- Check whether the problem is:
  - provider discovery
  - account event parsing
  - focus-triggered silent sync
  - action-page `sync()` / `invoke()` reconnect behavior
  - reload/session restore

## 7. Release Gate

Do not ship wallet changes unless all are true:

- `npm run check` passes
- `npm run build` passes
- `npm run test:wif-ui` passes with a real testnet wallet
- cross-page wallet state reuse is confirmed manually
- refresh-state restore is confirmed manually
