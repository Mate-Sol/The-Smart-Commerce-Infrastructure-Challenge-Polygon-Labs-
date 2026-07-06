# Repayment and Fee Logic

The Solana Anchor program is the authoritative source for all fee math. This document summarizes the model so off-chain code can present consistent quotes; the source of truth is `solana/code/paymate-pool-v2/programs/paymate-pool-v2/src/lib.rs`.

---

## 1. Day index

Day index is integer UTC: `unix_ts / 86_400`. A draw at 11pm and repay at 1am the next day counts as **2 days**.

---

## 2. Utilization fee (per drawdown)

```
util_fee = principal × util_bps × util_days / 10_000
```

where `util_days = min(days_active, tenor_days + grace_days)` and `days_active = repay_day − draw_day + 1` (inclusive).

Day breakdown for one drawdown:
- Days 1 through `tenor_days` — utilization rate.
- Day `tenor_days + 1` (grace day) — utilization rate.
- Day `tenor_days + 2` onwards — penalty rate (see below).

---

## 3. Penalty fee (per drawdown)

```
penalty_fee = principal × penalty_bps × penalty_days / 10_000
```

where `penalty_days = max(0, days_active − (tenor_days + grace_days))`.

While any drawdown is past `tenor_days + grace_days + penalty_days`, the facility is **blocked for new draws** until that drawdown is cleared.

---

## 4. Commitment fee (per pool, per day)

Commitment fee is per-day on the **peak outstanding during that day**:

```
commit_fee_today = (total_capital − peak_outstanding_today) × commit_bps / 10_000
```

Peak-outstanding (not end-of-day) ensures utilization and commitment fees never overlap on the same dollar. If the PSP repays a 1M loan and re-draws 750k same day, that day's commitment base is **0** because peak was 1M.

Commitment fee accrues lazily inside `request_drawdown`, `repay`, `settle_commit_fee`, and `redeem_lp` via the `accrue_commit_fee` helper.

---

## 5. Repayment cash flow

When a PSP signs `repay(drawdown_id)`:

```
total = principal + util_fee + penalty_fee + accrued_commit_fee_at_this_moment
```

USDC moves from the PSP wallet to the vault in one transfer. The program then:
1. Reduces `outstanding_principal` by `principal`.
2. Adds `util_fee` to `accrued_util_fee`.
3. Adds `penalty_fee` to `accrued_penalty_fee`.
4. Resets `accrued_commit_fee` to 0.
5. Moves a `protocol_fee_share_bps` cut of total fees to `protocol_fees_owed`.

---

## 6. Close-out gate

`redeem_lp` requires either:
- Facility is fully closed: `is_active && today >= tenor_end && count_active_drawdowns == 0 && accrued_commit_fee == 0`, **or**
- Admin has declared default.

The `accrued_commit_fee == 0` requirement is why the PSP must call `settle_commit_fee` after the last repayment day before lenders can redeem.

---

## 7. Default

If the PSP doesn't settle within `tenor_end + 30 days`, admin can sign `declare_default`. Lenders may then `redeem_lp` against whatever's in the vault — pro-rata haircut.

---

## 8. Where this is reflected off-chain

- `server/services/interestCalculator.js` — read-only quote helpers; should mirror on-chain math but the on-chain program is authoritative.
- `server/workers/repaymentAgent.js` — receives confirmation events from the chain indexer (Phase 3) and updates Mongo records.
- `client/src/components/RepaymentModal.jsx` — fetches a quote before the PSP signs.

Note: the previous EVM-era "Full Tenure Floor" rule (`interestDays = max(tenureDays, elapsedDays)`) is **gone**. The Solana program charges only for `days_active`, with grace + penalty if the PSP runs past tenor.
