/* ─────────────────────────────────────────────────────────────────────────────
   Pluto Capital — Risk Engine v2
   
   Automated background worker:
   - Runs every 5 seconds during market hours
   - Checks every active challenge and funded account
   - Daily loss, total drawdown, profit target, consistency, inactivity
   - Sends breach/pass emails automatically
   - Resets day_start_balance at midnight UTC
   - Pre-payout compliance verification
   - Fraud detection (weekend trading, news violation tracking)
───────────────────────────────────────────────────────────────────────────── */

const { queryOne, queryAll, run } = require('../models/database');
const { v4: uuidv4 } = require('uuid');
const config = require('../../config');

class RiskEngine {
  constructor() {
    this.running       = false;
    this.checkInterval = null;
    this.midnightTimer = null;
    this.lastCheck     = {};     // { challengeId: timestamp } — throttle per account
    this.recentBreaches= new Set(); // avoid duplicate emails
  }

  // ── Start background worker ───────────────────────────────────────────────
  start() {
    if (this.running) return;
    this.running = true;
    console.log('[RiskEngine] Background worker started — checking every 5s during market hours');

    // Main check loop
    this.checkInterval = setInterval(() => this._runChecks(), 5000);

    // Midnight reset of day_start_balance
    this._scheduleMidnightReset();

    // Immediate first run
    setTimeout(() => this._runChecks(), 2000);
  }

  stop() {
    this.running = false;
    if (this.checkInterval) clearInterval(this.checkInterval);
    if (this.midnightTimer) clearTimeout(this.midnightTimer);
  }

  // ── Market hours check ────────────────────────────────────────────────────
  _isMarketOpen() {
    const now = new Date();
    const day = now.getUTCDay(), h = now.getUTCHours();
    // Closed: all Saturday, Sunday before 22:00, Friday after 21:55
    return !(day === 6 || (day === 0 && h < 22) || (day === 5 && h >= 22));
  }

  // ── Main check loop ───────────────────────────────────────────────────────
  async _runChecks() {
    if (!this._isMarketOpen()) return;

    try {
      const challenges = await queryAll(`SELECT * FROM challenges WHERE status='active'`);
      const funded     = await queryAll(`SELECT * FROM funded_accounts WHERE status='active'`);

      for (const ch of challenges) {
        // Throttle: don't check same account more than once per 3 seconds
        const last = this.lastCheck[ch.id] || 0;
        if (Date.now() - last < 3000) continue;
        this.lastCheck[ch.id] = Date.now();

        const result = await this.checkChallenge(ch.id);
        if (result.targetReached) {
          await this.passChallenge(ch.id);
        }
      }

      for (const fa of funded) {
        const last = this.lastCheck[fa.id] || 0;
        if (Date.now() - last < 3000) continue;
        this.lastCheck[fa.id] = Date.now();
        await this.checkFundedAccount(fa.id);
      }
    } catch(e) {
      console.error('[RiskEngine] Check loop error:', e.message);
    }
  }

  // ── Check a challenge ─────────────────────────────────────────────────────
  async checkChallenge(challengeId) {
    const ch = await queryOne(`SELECT * FROM challenges WHERE id=$1 AND status='active'`, [challengeId]);
    if (!ch) return { breached: false };

    const equity   = ch.current_equity || ch.current_balance || ch.starting_balance;
    const balance  = ch.current_balance || ch.starting_balance;
    const dayStart = ch.day_start_balance || ch.starting_balance;

    // ── MAX TOTAL DRAWDOWN ────────────────────────────────────────────────
    const totalFloor = ch.starting_balance * (1 - ch.max_total_loss_pct / 100);
    if (equity <= totalFloor) {
      await this.breachChallenge(challengeId, 'MAX_TOTAL_DRAWDOWN',
        `Equity ${equity.toFixed(2)} fell below floor ${totalFloor.toFixed(2)}`);
      return { breached: true, reason: 'MAX_TOTAL_DRAWDOWN' };
    }

    // ── MAX DAILY LOSS ────────────────────────────────────────────────────
    const dailyPnL   = equity - dayStart;
    const dailyLimit = -(dayStart * ch.max_daily_loss_pct / 100);
    if (dailyPnL <= dailyLimit) {
      await this.breachChallenge(challengeId, 'MAX_DAILY_LOSS',
        `Daily loss ${Math.abs(dailyPnL).toFixed(2)} exceeded limit ${Math.abs(dailyLimit).toFixed(2)}`);
      return { breached: true, reason: 'MAX_DAILY_LOSS' };
    }

    // ── CONSISTENCY RULE ──────────────────────────────────────────────────
    // No single trading day > 30% of total realized profit
    // Skipped for 'rapid' challenge type (no consistency rule)
    const isRapid = ch.challenge_type === 'rapid';
    const consistencyPct = config.oneStepRules.consistency_rule_pct || 30;
    if (!isRapid && ch.total_profit > 0 && ch.best_day_profit > 0) {
      const bestDayPct = (ch.best_day_profit / ch.total_profit) * 100;
      if (bestDayPct > consistencyPct) {
        await this.breachChallenge(challengeId, 'CONSISTENCY_VIOLATION',
          `Best day profit ${ch.best_day_profit.toFixed(2)} is ${bestDayPct.toFixed(1)}% of total (max ${consistencyPct}%)`);
        return { breached: true, reason: 'CONSISTENCY_VIOLATION' };
      }
    }

    // ── INACTIVITY ────────────────────────────────────────────────────────
    if (ch.last_trade_at) {
      const daysSinceTrade = (Date.now() - new Date(ch.last_trade_at).getTime()) / 86400000;
      if (daysSinceTrade >= 30) {
        await this.breachChallenge(challengeId, 'INACTIVITY',
          `No trades for ${Math.floor(daysSinceTrade)} days`);
        return { breached: true, reason: 'INACTIVITY' };
      }
    }

    // ── PROFIT TARGET ─────────────────────────────────────────────────────
    const targetBalance = ch.starting_balance * (1 + ch.profit_target_pct / 100);
    if (balance >= targetBalance) {
      const tradingDays = await queryOne(
        `SELECT COUNT(DISTINCT DATE(close_time)) as days FROM trades WHERE challenge_id=$1 AND status='closed'`,
        [challengeId]
      );
      const days = parseInt(tradingDays?.days || 0);
      if (days < 3) {
        return { breached: false, targetReached: false, reason: 'MIN_DAYS_NOT_MET', trading_days: days };
      }
      return { breached: false, targetReached: true, reason: 'PROFIT_TARGET_REACHED' };
    }

    return { breached: false };
  }

  // ── Check funded account ──────────────────────────────────────────────────
  async checkFundedAccount(fundedId) {
    const fa = await queryOne(`SELECT * FROM funded_accounts WHERE id=$1 AND status='active'`, [fundedId]);
    if (!fa) return { breached: false };

    const equity   = fa.current_equity || fa.current_balance || fa.starting_balance;
    const dayStart = fa.day_start_balance || fa.starting_balance;

    const totalFloor = fa.starting_balance * (1 - fa.max_total_loss_pct / 100);
    if (equity <= totalFloor) {
      await run(`UPDATE funded_accounts SET status='breached',breach_reason='MAX_TOTAL_DRAWDOWN',breached_at=? WHERE id=?`,
        [new Date().toISOString(), fundedId]);
      try {
        const oe = require('./orderEngine');
        await oe.adminForceClose(null, fundedId);
        await run(`UPDATE pending_orders SET status='cancelled', cancelled_at=?, cancel_reason='Account breached' WHERE funded_account_id=? AND status='pending'`,
          [new Date().toISOString(), fundedId]);
      } catch(e) { console.error('[RiskEngine] funded closeAll error:', e.message); }
      await this._sendBreachEmail(fundedId, 'funded', 'MAX_TOTAL_DRAWDOWN', equity, totalFloor);
      return { breached: true, reason: 'MAX_TOTAL_DRAWDOWN' };
    }

    const dailyPnL   = equity - dayStart;
    const dailyLimit = -(dayStart * fa.max_daily_loss_pct / 100);
    if (dailyPnL <= dailyLimit) {
      await run(`UPDATE funded_accounts SET status='breached',breach_reason='MAX_DAILY_LOSS',breached_at=? WHERE id=?`,
        [new Date().toISOString(), fundedId]);
      try {
        const oe = require('./orderEngine');
        await oe.adminForceClose(null, fundedId);
        await run(`UPDATE pending_orders SET status='cancelled', cancelled_at=?, cancel_reason='Account breached' WHERE funded_account_id=? AND status='pending'`,
          [new Date().toISOString(), fundedId]);
      } catch(e) { console.error('[RiskEngine] funded closeAll error:', e.message); }
      await this._sendBreachEmail(fundedId, 'funded', 'MAX_DAILY_LOSS', dailyPnL, dailyLimit);
      return { breached: true, reason: 'MAX_DAILY_LOSS' };
    }

    return { breached: false };
  }

  // ── Breach a challenge ────────────────────────────────────────────────────
  async breachChallenge(challengeId, reason, details = '') {
    // Prevent duplicate breach processing
    if (this.recentBreaches.has(challengeId)) return;
    this.recentBreaches.add(challengeId);
    setTimeout(() => this.recentBreaches.delete(challengeId), 30000);

    console.log(`[RiskEngine] BREACH ${challengeId.slice(0,8)} — ${reason}: ${details}`);

    await run(`UPDATE challenges SET status='failed',failed_at=?,breach_reason=? WHERE id=?`,
      [new Date().toISOString(), reason, challengeId]);

    // Close all open positions and cancel pending orders
    try {
      const orderEngine = require('./orderEngine');
      await orderEngine.adminForceClose(challengeId, null);
      // Cancel any pending orders so nothing fires after breach
      await run(`UPDATE pending_orders SET status='cancelled', cancelled_at=?, cancel_reason='Account breached' WHERE challenge_id=? AND status='pending'`,
        [new Date().toISOString(), challengeId]);
    } catch(e) { console.error('[RiskEngine] closeAll error:', e.message); }

    await run(`INSERT INTO audit_log (id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)`,
      [uuidv4(), 'CHALLENGE_BREACHED', 'challenge', challengeId, `${reason}: ${details}`]);

    await this._sendBreachEmail(challengeId, 'challenge', reason, null, null, details);
  }

  // ── Pass a challenge ──────────────────────────────────────────────────────
  async passChallenge(challengeId) {
    const ch = await queryOne(`SELECT * FROM challenges WHERE id=$1 AND status='active'`, [challengeId]);
    if (!ch) return null;

    const email = require('./email');
    const usr = await queryOne(`SELECT first_name, email FROM users WHERE id=$1`, [ch.user_id]);

    if (ch.challenge_type === 'two_step' && (ch.phase === 1 || !ch.phase)) {
      console.log(`[RiskEngine] 2-STEP PHASE 1 PASSED ${challengeId.slice(0,8)} — creating Phase 2`);
      await run(`UPDATE challenges SET status='passed',passed_at=? WHERE id=?`, [new Date().toISOString(), challengeId]);

      const phase2Id = uuidv4();
      const phase2Target = config.twoStepRules.phase2_target_pct;
      // PlutoTrader: login = same email, new password
      const traderLogin = usr?.email || ch.ctrader_login || '';
      const traderPass  = require('../utils/helpers').generateId().slice(0, 12);

      await run(`INSERT INTO challenges (id,user_id,account_size,challenge_type,phase,parent_challenge_id,starting_balance,current_balance,current_equity,highest_balance,lowest_equity,day_start_balance,fee_paid,profit_split_pct,leverage,profit_target_pct,max_daily_loss_pct,max_total_loss_pct,ctrader_login,ctrader_account_id,ctrader_server,ctrader_password,platform,status,activated_at) VALUES (?,?,?,'two_step',2,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,'plutotrade','active',?)`,
        [phase2Id, ch.user_id, ch.account_size, challengeId,
         ch.account_size, ch.account_size, ch.account_size, ch.account_size, ch.account_size, ch.account_size,
         ch.profit_split_pct, ch.leverage, phase2Target, ch.max_daily_loss_pct, ch.max_total_loss_pct,
         traderLogin, phase2Id, 'PlutoTrader', traderPass,
         new Date().toISOString()]);

      await run(`INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?)`,
        [uuidv4(), ch.user_id, 'PHASE1_PASSED', 'challenge', challengeId, 'Phase 1 passed — Phase 2 created']);

      if (usr) {
        email.sendChallengePassed(usr.email, usr.first_name||'Trader', {
          account_size: '$' + Number(ch.account_size).toLocaleString(),
          profit: '$' + (ch.current_balance - ch.starting_balance).toFixed(2),
          trades: String(ch.total_trades),
          win_rate: ch.total_trades ? Math.round(ch.winning_trades / ch.total_trades * 100) + '%' : '0%',
          phase: '1', next_phase: '2', next_target: phase2Target + '%',
        }).catch(e => console.error('[RiskEngine] email:', e.message));
      }
      return { phase2_created: true, phase2_id: phase2Id };
    }

    // 1-Step or Phase 2 passed → create funded account
    console.log(`[RiskEngine] PASSED ${challengeId.slice(0,8)} — creating funded account`);
    await run(`UPDATE challenges SET status='passed',passed_at=? WHERE id=?`, [new Date().toISOString(), challengeId]);

    // Create funded account — PlutoTrader only
    const fundedId = uuidv4();
    const fundedLogin = usr?.email || ch.ctrader_login || '';
    const fundedPass  = require('../utils/helpers').generateId().slice(0, 12);
    await run(`INSERT INTO funded_accounts (id,user_id,challenge_id,account_size,starting_balance,current_balance,current_equity,highest_balance,lowest_equity,day_start_balance,profit_split_pct,ctrader_login,ctrader_password,ctrader_account_id,max_daily_loss_pct,max_total_loss_pct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [fundedId, ch.user_id, challengeId, ch.account_size, ch.account_size,
       ch.account_size, ch.account_size, ch.account_size, ch.account_size, ch.account_size,
       ch.profit_split_pct, fundedLogin, fundedPass, fundedId, ch.max_daily_loss_pct, ch.max_total_loss_pct]);

    await run(`INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?)`,
      [uuidv4(), ch.user_id, 'CHALLENGE_PASSED', 'challenge', challengeId, 'Profit target reached — funded account created']);

    if (usr) {
      email.sendChallengePassed(usr.email, usr.first_name||'Trader', {
        account_size: '$' + Number(ch.account_size).toLocaleString(),
        profit: '$' + (ch.current_balance - ch.starting_balance).toFixed(2),
        trades: String(ch.total_trades),
        win_rate: ch.total_trades ? Math.round(ch.winning_trades / ch.total_trades * 100) + '%' : '0%',
      }).catch(e => console.error('[RiskEngine] email:', e.message));
    }

    return { funded_account_id: fundedId };
  }

  // ── PRE-PAYOUT COMPLIANCE CHECK ───────────────────────────────────────────
  // Full verification before any payout is approved
  async prePayoutCheck(fundedAccountId) {
    const fa  = await queryOne(`SELECT * FROM funded_accounts WHERE id=$1`, [fundedAccountId]);
    if (!fa) return { approved: false, reason: 'Funded account not found' };

    const usr = await queryOne(`SELECT * FROM users WHERE id=$1`, [fa.user_id]);
    const trades = await queryAll(`SELECT * FROM trades WHERE funded_account_id=$1 AND status='closed' ORDER BY close_time DESC`, [fundedAccountId]);
    const openTrades = await queryAll(`SELECT * FROM trades WHERE funded_account_id=$1 AND status='open'`, [fundedAccountId]);

    const checks = [];
    let approved = true;

    // 1. KYC check
    const kycOk = usr?.kyc_status === 'approved';
    checks.push({ name: 'KYC Verified', pass: kycOk, detail: kycOk ? 'Identity verified' : `KYC status: ${usr?.kyc_status||'none'}` });
    if (!kycOk) approved = false;

    // 2. No open positions
    const noOpen = openTrades.length === 0;
    checks.push({ name: 'No Open Positions', pass: noOpen, detail: noOpen ? 'All positions closed' : `${openTrades.length} positions still open` });
    if (!noOpen) approved = false;

    // 3. Account status
    const activeOk = fa.status === 'active';
    checks.push({ name: 'Account Active', pass: activeOk, detail: activeOk ? 'Account in good standing' : `Account status: ${fa.status}` });
    if (!activeOk) approved = false;

    // 4. Minimum profitable period (at least 5 trading days since last payout)
    const lastPayout = await queryOne(`SELECT paid_at FROM payouts WHERE funded_account_id=$1 AND status='paid' ORDER BY paid_at DESC LIMIT 1`, [fundedAccountId]);
    const daysSincePayout = lastPayout?.paid_at
      ? (Date.now() - new Date(lastPayout.paid_at).getTime()) / 86400000
      : 999;
    const minDaysOk = daysSincePayout >= 14; // 2 weeks between payouts
    checks.push({ name: 'Payout Cooling Period (14 days)', pass: minDaysOk, detail: minDaysOk ? `${Math.floor(daysSincePayout)} days since last payout` : `Only ${Math.floor(daysSincePayout)} days (need 14)` });
    if (!minDaysOk) approved = false;

    // 5. Minimum profit ($50)
    const profit = (fa.current_balance||fa.starting_balance) - fa.starting_balance;
    const minProfitOk = profit >= (config.defaultRules.min_payout || 50);
    checks.push({ name: `Minimum Profit ($${config.defaultRules.min_payout||50})`, pass: minProfitOk, detail: `Profit: $${profit.toFixed(2)}` });
    if (!minProfitOk) approved = false;

    // 6. Risk rules compliance — no drawdown breach
    const equity = fa.current_equity || fa.current_balance || fa.starting_balance;
    const ddOk = equity > fa.starting_balance * (1 - fa.max_total_loss_pct / 100);
    checks.push({ name: 'Drawdown Compliant', pass: ddOk, detail: ddOk ? `Equity $${equity.toFixed(2)} within limits` : 'Drawdown limit would be breached' });
    if (!ddOk) approved = false;

    // 7. Weekend trading check — scan trades for weekend timestamps
    const weekendTrades = trades.filter(t => {
      if (!t.open_time) return false;
      const d = new Date(t.open_time).getUTCDay();
      return d === 6; // Saturday
    });
    const noWeekend = weekendTrades.length === 0;
    checks.push({ name: 'No Weekend Trading', pass: noWeekend, detail: noWeekend ? 'No violations found' : `${weekendTrades.length} trades opened on Saturday` });
    // Weekend trading = warning, not hard block
    if (!noWeekend) checks[checks.length-1].warning = true;

    // 8. Consistency — no single day > 50% of total profit (red flag)
    if (trades.length > 0) {
      const dayPnL = {};
      trades.forEach(t => {
        const d = t.close_time?.split('T')[0] || 'unknown';
        dayPnL[d] = (dayPnL[d]||0) + (t.profit||0);
      });
      const totalPnL  = Object.values(dayPnL).reduce((s,v)=>s+v,0);
      const bestDay   = Math.max(...Object.values(dayPnL));
      const consistOk = totalPnL <= 0 || bestDay <= totalPnL * 0.5;
      checks.push({ name: 'Consistency (no day > 50% of total)', pass: consistOk, detail: consistOk ? `Best day: $${bestDay.toFixed(2)}` : `Best day $${bestDay.toFixed(2)} is ${(bestDay/totalPnL*100).toFixed(0)}% of total profit — flagged for review` });
      if (!consistOk) checks[checks.length-1].warning = true;
    }

    // 9. Win rate sanity (warn if > 95% win rate — may indicate exploitation)
    if (trades.length >= 10) {
      const winRate = trades.filter(t=>t.profit>0).length / trades.length;
      const winRateOk = winRate <= 0.95;
      checks.push({ name: 'Win Rate Sanity (<95%)', pass: winRateOk, detail: `Win rate: ${(winRate*100).toFixed(1)}%${!winRateOk?' — unusually high, manual review recommended':''}` });
      if (!winRateOk) checks[checks.length-1].warning = true;
    }

    // Summary
    const passed = checks.filter(c=>c.pass).length;
    const warnings = checks.filter(c=>c.warning).length;
    const traderAmount = profit * (fa.profit_split_pct||80) / 100;

    return {
      approved,
      funded_account_id: fundedAccountId,
      trader_name: `${usr?.first_name||''} ${usr?.last_name||''}`.trim(),
      trader_email: usr?.email,
      account_size: fa.account_size,
      current_balance: fa.current_balance||fa.starting_balance,
      profit: profit,
      profit_split_pct: fa.profit_split_pct||80,
      trader_amount: traderAmount,
      firm_amount: profit - traderAmount,
      total_trades: trades.length,
      checks,
      passed_checks: passed,
      total_checks: checks.length,
      warnings,
      summary: approved
        ? `✅ Payout approved — $${traderAmount.toFixed(2)} to trader (${fa.profit_split_pct||80}% of $${profit.toFixed(2)} profit)`
        : `❌ Payout blocked — ${checks.filter(c=>!c.pass&&!c.warning).length} compliance check(s) failed`,
    };
  }

  // ── RESET DAILY BALANCES ──────────────────────────────────────────────────
  async resetDailyBalances() {
    console.log('[RiskEngine] Resetting daily start balances (midnight UTC)');
    await run(`UPDATE challenges SET day_start_balance=current_balance WHERE status='active'`);
    await run(`UPDATE funded_accounts SET day_start_balance=current_balance WHERE status='active'`);
    await run(`INSERT INTO audit_log (id,action,entity_type,entity_id,details) VALUES (?,'DAILY_RESET','system','all','day_start_balance reset at midnight UTC')`,
      [uuidv4()]);
  }

  _scheduleMidnightReset() {
    const now = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()+1, 0, 0, 5));
    const ms = midnight - now;
    this.midnightTimer = setTimeout(() => {
      this.resetDailyBalances();
      // Reschedule for next midnight
      this._scheduleMidnightReset();
    }, ms);
    console.log(`[RiskEngine] Next daily reset in ${Math.round(ms/3600000)}h`);
  }

  // ── Email helpers ─────────────────────────────────────────────────────────
  async _sendBreachEmail(accountId, type, reason, equity, floor, details) {
    try {
      const email = require('./email');
      let account, user;
      if (type === 'challenge') {
        account = await queryOne(`SELECT * FROM challenges WHERE id=$1`, [accountId]);
      } else {
        account = await queryOne(`SELECT * FROM funded_accounts WHERE id=$1`, [accountId]);
      }
      if (!account) return;
      user = await queryOne(`SELECT first_name, last_name, email FROM users WHERE id=$1`, [account.user_id]);
      if (!user) return;

      const reasonLabels = {
        MAX_TOTAL_DRAWDOWN:    'Maximum Total Drawdown Exceeded',
        MAX_DAILY_LOSS:        'Daily Loss Limit Exceeded',
        CONSISTENCY_VIOLATION: 'Consistency Rule Violated',
        INACTIVITY:            'Account Inactivity (45 days)',
        RULE_VIOLATION:        'Trading Rule Violation',
        ADMIN_ACTION:          'Administrative Action',
      };
      const reasonText = reasonLabels[reason] || reason;
      const isFunded = type === 'funded';
      const size = `$${Number(account.account_size).toLocaleString()}`;
      const bal  = `$${Number(account.current_balance||account.starting_balance||0).toFixed(2)}`;
      const floorStr = floor ? `$${Number(floor).toFixed(2)}` : '—';
      const eqStr    = equity ? `$${Number(equity).toFixed(2)}` : '—';
      const now = new Date().toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})+ ' UTC';

      await email.sendChallengeFailed(user.email, user.first_name||'Trader', {
        account_size:   size,
        reason:         reasonText,
        balance:        bal,
        equity:         eqStr,
        floor:          floorStr,
        trades:         String(account.total_trades || 0),
        breached_at:    now,
        account_type:   isFunded ? 'Funded Account' : (account.challenge_type === 'two_step' ? '2-Step Evaluation' : account.challenge_type === 'rapid' ? 'PlutoRapid' : '1-Step Evaluation'),
        detail:         details || '',
      });

      console.log(`[RiskEngine] Breach email sent to ${user.email} — reason: ${reason}`);
    } catch(e) { console.error('[RiskEngine] breach email error:', e.message); }
  }

  // ── Update risk params for an account (from admin dashboard) ─────────────
  async updateAccountRiskParams(challengeId, params) {
    const fields = [], vals = [];
    const allowed = ['max_daily_loss_pct','max_total_loss_pct','profit_target_pct','profit_split_pct','leverage'];
    for (const [k, v] of Object.entries(params)) {
      if (allowed.includes(k)) { fields.push(`${k}=?`); vals.push(v); }
    }
    if (!fields.length) return;
    vals.push(challengeId);
    await run(`UPDATE challenges SET ${fields.join(',')} WHERE id=?`, vals);
    await run(`INSERT INTO audit_log (id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)`,
      [uuidv4(),'RISK_PARAMS_UPDATED','challenge',challengeId,`Updated: ${fields.join(', ')}`]);
    // Clear cached check so new params take effect immediately
    delete this.lastCheck[challengeId];
    console.log(`[RiskEngine] Risk params updated for ${challengeId.slice(0,8)}: ${fields.join(', ')}`);
  }
}

module.exports = new RiskEngine();
