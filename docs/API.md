# Pluto Capital Funding — API Reference

Base URL: `http://localhost:3000/api`

All authenticated endpoints require `Authorization: Bearer <token>` header.

---

## Authentication

### POST /auth/register
**Body:** `{ "email", "password", "first_name", "last_name" }`
**Response:** `{ "token": "jwt...", "user": { ... } }`

### POST /auth/login
**Body:** `{ "email", "password" }`
**Response:** `{ "token": "jwt...", "user": { ... } }`

---

## User Profile (auth required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /users/profile | Get user profile |
| PUT | /users/profile | Update profile (first_name, last_name, phone, country) |
| POST | /users/kyc/start | Initiate KYC — returns Sumsub access token for WebSDK |

---

## Challenges (auth required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /challenges | List all user challenges |
| GET | /challenges/:id | Single challenge detail |
| POST | /challenges/purchase | Buy challenge — body: `{ account_size, profit_split, payment_method }` |
| GET | /challenges/:id/risk-check | Run risk engine check |
| GET | /challenges/info/pricing | Public pricing (no auth) |

Valid account sizes: `10000, 25000, 50000, 100000, 200000, 500000`

Purchase response includes cTrader login credentials and account rules.

---

## Funded Accounts (auth required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /funded | List funded accounts |
| GET | /funded/:id | Single account detail |
| GET | /funded/:id/scaling | Check scaling eligibility |

---

## Payouts (auth required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /payouts | Payout history |
| POST | /payouts/request | Request payout — body: `{ funded_account_id, payout_method, wallet_address }` |

Payout methods: `crypto_usdt, crypto_usdc, bank_transfer, rise, wise`

---

## Trades (auth required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /trades | Trade history — query: `challenge_id, funded_account_id, symbol, limit` |
| GET | /trades/stats | Aggregate stats: win rate, profit factor, symbol breakdown |

---

## Public

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /pricing | Challenge plans and pricing |
| GET | /health | Server health check |

---

## Admin (admin role required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/overview | Dashboard KPIs |
| GET | /admin/users | All users |
| GET | /admin/challenges | All challenges (optional `?status=active`) |
| GET | /admin/funded | All funded accounts |
| GET | /admin/payouts | All payouts (optional `?status=requested`) |
| POST | /admin/payouts/:id/approve | Approve payout |
| POST | /admin/payouts/:id/pay | Mark payout as paid |
| POST | /admin/payouts/:id/reject | Reject payout (optional `{ "reason": "..." }`) |
| POST | /admin/users/:id/suspend | Suspend user |
| POST | /admin/users/:id/activate | Reactivate user |
| POST | /admin/users/:id/kyc-approve | Manual KYC approval |
| GET | /admin/audit-log | Audit trail (last 200) |
| GET | /admin/transactions | Financial transactions |
