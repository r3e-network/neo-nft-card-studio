# NeoLine Frontend Integration Guide

This document describes the current Neo N3 wallet integration used by this project, the design constraints behind it, common failure modes, and the fixes that were applied to make wallet connection stable.

Relevant implementation files:

- `/Users/jinghuiliao/git/NFT/apps/web/src/lib/neoline.ts`
- `/Users/jinghuiliao/git/NFT/apps/web/src/hooks/useWallet.tsx`
- `/Users/jinghuiliao/git/NFT/apps/web/src/lib/runtime-network.ts`
- `/Users/jinghuiliao/git/NFT/apps/web/src/components/LayoutShell.tsx`
- `/Users/jinghuiliao/git/NFT/apps/web/src/lib/api.ts`

## 1. Integration Goals

The wallet layer must satisfy these requirements:

1. Support Neo N3 browser wallets such as NeoLine and compatible wrappers.
2. Detect wallet providers from multiple global injection styles.
3. Separate explicit user-triggered connect behavior from silent session restore behavior.
4. Bind runtime API and RPC selection to the connected wallet network.
5. Avoid repeated wallet popup prompts during page load, focus recovery, and event handling.
6. Continue working even when wallet providers return account data via events instead of immediate method results.

## 2. Architecture Overview

The current integration is split into four layers:

### 2.1 Provider Discovery

File: `/Users/jinghuiliao/git/NFT/apps/web/src/lib/neoline.ts`

Responsibilities:

- Discover provider candidates from `window.NEOLineN3`, `window.neoLineN3`, `window.NEOLine`, `window.neoLine`, `window.o3dapi?.n3?.dapp`, `window.OneGateProvider`.
- Resolve nested wrapper objects and `Init()`-style factories.
- Filter out EVM-only injected wallets that expose unrelated globals.
- Normalize providers into a consistent interface.

### 2.2 Wallet Session State

File: `/Users/jinghuiliao/git/NFT/apps/web/src/hooks/useWallet.tsx`

Responsibilities:

- Expose `address`, `network`, `isReady`, `isConnecting`, `connect`, `disconnect`, `sync`, `invoke`.
- Restore session state from wallet and local storage.
- Hold the current connected address in React state.
- Prevent silent sync from clearing valid in-memory wallet state immediately after popup-driven connect.

### 2.3 Runtime Network Binding

File: `/Users/jinghuiliao/git/NFT/apps/web/src/lib/runtime-network.ts`

Responsibilities:

- Store the currently bound wallet network at runtime.
- Select RPC and API endpoints according to wallet network.
- Fail closed when wallet network is unknown.

### 2.4 UI Binding

File: `/Users/jinghuiliao/git/NFT/apps/web/src/components/LayoutShell.tsx`

Responsibilities:

- Render `Connect` / connected address.
- Use `wallet.address` as the source of truth for whether the UI is connected.
- Reflect `wallet.isConnecting`.

## 3. Provider Discovery Rules

The integration intentionally supports more than one provider shape because Neo wallets are not injected consistently.

Current discovery sources include:

- `window.NEOLineN3`
- `window.neoLineN3`
- `window.NEOLine`
- `window.neoLine`
- `window.o3dapi?.n3?.dapp`
- `window.OneGateProvider`

The discovery layer also handles:

- Factory-style providers exposed as `Init()` or `init()`
- Nested provider containers such as `provider`, `dapp`, `n3`, `wallet`, `client`, `api`, `bridge`
- Event-only wrappers exposing `EVENT` / `EVENTLIST`

Important rule:

- Do not assume the first injected wallet global is the real provider object. Always resolve nested providers and normalize them first.

## 4. Supported Account Acquisition Paths

The integration now attempts account resolution in this order during explicit connect:

1. `getAccount()`
2. `requestAccounts()`
3. `getAddress()`
4. `getWalletAddress()`
5. `getAccounts()`
6. RPC-style `request/send/sendAsync`
7. `enable()`
8. Direct account re-read after `enable()`
9. Wallet events such as `CONNECTED` / `ACCOUNT_CHANGED`

Important detail:

- Some wallets open the popup on `getAccount()`.
- Some wallets only return data after `enable()`.
- Some wallets do not return the address directly and instead emit it through an event.
- Some wallets place the address inside `event.detail`.

The implementation must handle all four patterns.

## 5. Silent Sync vs Explicit Connect

This is the most important operational rule.

### 5.1 Explicit Connect

Explicit connect is only allowed when the user clicks the connect button.

Allowed behaviors:

- prompt wallet popup
- request account access
- wait for wallet account events
- call interactive methods

Implementation path:

- `wallet.connect()`
- `connectNeoWallet()`
- `connectSingleProvider()`

### 5.2 Silent Sync

Silent sync is used during:

- page mount
- focus recovery
- wallet event follow-up

Silent sync must never trigger a wallet authorization popup.

Allowed behaviors:

- read current provider state
- read direct in-memory provider account fields
- read current runtime network

Forbidden behaviors:

- `requestAccounts()`
- `switchWalletAccount()`
- any equivalent interactive prompt path
- clearing valid in-memory address immediately after popup close just because a silent read temporarily returns no account

This separation is the reason the repeated popup loop was fixed.

## 6. Event Handling Rules

Wallet account state can come back from multiple event styles.

The current code supports:

- provider event callbacks
- global `window` / `document` events
- payloads where the account is in:
  - `event.address`
  - `event.accAddress`
  - `event.walletAddress`
  - `event.detail.address`
  - `event.detail.accAddress`
  - `event.data`
  - `event.account`
  - `event.result`

Important rule:

- Never assume event payloads are flat.
- Always recursively extract address from `detail`, `data`, `account`, and `result`.

## 7. Current Stability Fixes Applied

These are the concrete fixes already made in this repo.

### 7.1 Broken Provider Helper Refactor

Problem:

- `neoline.ts` referenced helpers that no longer existed.
- Vercel builds failed with TypeScript errors.

Fix:

- Rebuilt the wallet adapter into a coherent provider discovery and connect layer.

### 7.2 Repeated Popup Loop

Problem:

- Silent sync used interactive account methods.
- Focus recovery and event handling caused repeated popup requests.

Fix:

- Silent sync now reads only passive state.
- Interactive account methods are limited to explicit `connect()`.

### 7.3 Successful Wallet Connect But UI Stayed on Connect

Problem:

- The wallet returned an address via event, but the state layer later cleared it.
- Focus recovery or silent sync could run immediately after popup close and overwrite valid connected state.

Fix:

- Added a short suppression window after explicit connect.
- If silent sync temporarily cannot read account but memory already holds a valid address, the current state is preserved.

### 7.4 Event Payload Address Was Ignored

Problem:

- NeoLine-compatible event payload returned the address in a nested shape.
- The UI event handler only checked `data.address` and `data[0].address`.

Fix:

- Event parsing now recursively extracts address from nested payload shapes, including `detail`.

### 7.5 Enable Returned No Address

Problem:

- Some wallets use `enable()` only as authorization, then expose the account in a separate read call or event.

Fix:

- After `enable()`, the integration explicitly re-reads account state and also waits for events.

### 7.6 Connecting Spinner Never Finished

Problem:

- Some wallet methods remained pending indefinitely.

Fix:

- Connection attempts now use timeouts and race against account events.

## 8. Common Failure Modes and Fixes

### 8.1 Popup Repeats Forever

Symptoms:

- Wallet popup appears repeatedly.
- User approves once, then another request appears.

Root cause:

- Silent sync or event follow-up still calls interactive wallet methods.

Fix:

- Restrict interactive methods to explicit connect only.
- Never call `requestAccounts()` during passive sync.

### 8.2 Wallet Popup Succeeds But UI Still Shows Connect

Symptoms:

- Wallet popup returns account.
- Console shows account event.
- Header button still shows `Connect`.

Root cause:

- Event payload shape not parsed correctly, or silent sync clears state after popup close.

Fix:

- Parse nested event payloads.
- Protect recent successful connect state from immediate silent-sync invalidation.

### 8.3 Connect Spinner Never Stops

Symptoms:

- Button stays on `Connecting...`
- No error appears.

Root cause:

- Wallet method promise never resolves or rejects.

Fix:

- Add method-level timeout.
- Race method calls against wallet account events.

### 8.4 Connect Fails With `Failed to connect to wallet.`

Symptoms:

- Connect button fails immediately or after popup.

Root cause:

- Provider method called but no address was extracted.
- Wrong provider selected.
- Wallet returns data only via an unsupported method/event shape.

Fix:

- Use diagnostic logging.
- Inspect `[wallet-debug]` output.
- Extend parser for the actual payload shape returned by the wallet.

## 9. Debugging Procedure

When wallet connect fails, do this in order.

### 9.1 Check Console Diagnostics

The current code logs:

- `[wallet-debug] connect:providers ...`
- `[wallet-debug] connect:start ...`
- `[wallet-debug] connect:attempt ...`
- `[wallet-debug] connect:event ...`
- `[wallet-debug] connect:success ...`
- `[wallet-debug] connect:failed ...`

What to inspect:

1. How many providers were detected.
2. Which provider was selected.
3. Which method was attempted first.
4. Whether an event arrived.
5. Whether the event contained a usable Neo N3 address.
6. Whether failure happened after a valid event, which usually indicates state overwrite after connect.

### 9.2 Verify UI State Source

The top bar uses `wallet.address`.

If connect logs show a valid address but UI still shows `Connect`, the bug is not provider discovery anymore. It is state overwrite in `useWallet.tsx`.

### 9.3 Verify Silent Sync Timing

If popup closes and UI briefly updates, then returns to `Connect`, inspect:

- focus event handling
- event callback sync behavior
- session restore effect

### 9.4 Verify Network Read Is Not Blocking Account Display

The UI should show address as soon as account is known.

Network detection should be best-effort and asynchronous.

Do not block the connected UI on `getNetwork()`.

## 10. Recommended Usage Pattern for Future Code

### Do

- Keep `connect()` explicitly interactive.
- Keep `sync()` passive unless the user explicitly asked to reconnect.
- Update address and network independently.
- Treat wallet events as authoritative when they contain a valid address.
- Preserve a freshly connected address during popup-close focus churn.
- Log provider behavior during wallet bugs.

### Do Not

- Call `requestAccounts()` during mount.
- Call `enable()` before every invoke.
- Call `switchWalletAccount()` as the default connect step.
- Clear valid connected state immediately because one silent read returned null.
- Assume wallet event payload is always `{ address: "..." }`.

## 11. Suggested Regression Checklist

Before releasing wallet changes, validate all of the following:

1. No wallet installed:
   - connect shows a clear install-wallet message
2. Wallet installed but locked:
   - connect does not hang forever
3. Wallet popup approved:
   - address appears in header
   - button changes from `Connect` to short address
4. Popup closes:
   - no second popup appears automatically
5. Focus returns to page:
   - connected state remains stable
6. Network event fires:
   - network badge updates
7. Reload page:
   - silent restore does not reopen popup
8. Invoke transaction:
   - no extra connect popup appears before invoke unless wallet itself requires it

## 12. Suggested Future Improvements

If wallet issues continue, the next upgrades should be:

1. Add an on-screen developer diagnostics panel in `DEV` mode showing:
   - detected provider count
   - selected provider name
   - last connect step
   - last raw wallet payload summary

2. Add Playwright-based wallet mock tests for:
   - account returned directly
   - account returned only via event
   - account missing on first sync but available after popup

3. Add a small provider capability matrix in code:
   - NeoLine
   - OneGate
   - O3-style wrapper

4. Persist a provider fingerprint so reconnect attempts prefer the same provider instance across refreshes.

## 13. Operational Guidance for the Team

When changing wallet integration:

1. Edit `/Users/jinghuiliao/git/NFT/apps/web/src/lib/neoline.ts` first.
2. Keep `/Users/jinghuiliao/git/NFT/apps/web/src/hooks/useWallet.tsx` focused on state, not provider-specific behavior.
3. Run:
   - `npm run typecheck --workspace @platform/web`
   - `npm run build --workspace @platform/web`
4. If wallet behavior changes in browser:
   - inspect `[wallet-debug]` logs before changing logic
5. Do not remove diagnostics until the behavior is stable across the wallet versions you actively support.

## 14. Short Root-Cause Summary of the Incident

The wallet integration failed for a chain of reasons, not a single bug:

1. The adapter file had a broken half-refactor.
2. Silent sync used interactive account methods, causing repeated popup loops.
3. Some wallet methods returned no direct account data.
4. Some wallets emitted the address only through events.
5. Event payloads placed address under `detail`.
6. Focus recovery and silent sync cleared valid state immediately after popup close.
7. The UI initially waited on network resolution longer than it should.

The fixes in this repo now address all seven points.
