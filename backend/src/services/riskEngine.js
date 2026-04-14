const { queryOne, run } = require('../models/database');
const ctrader = require('./ctrader');
const config = require('../../config');

// ============================================================
// RISK ENGINE
//
// Monitors all active challenges and funded accounts.
// In production, this runs as a separate process or cron job
// polling cTrader every 1-5 seconds during market hours.
//
// For the localhost demo, these functions are called on-demand
// via API endpoints. Convert to a
// background worker (Bull queue, cron, or standalone service).
// ============================================================

class RiskEngine {
  /**
   * Check a single challenge account for breaches
   * Returns: { breached: boolean, reason?: string }
   */
  async checkChallenge(challengeId) {
    const ch = queryOne(`SELECT * FROM challenges WHERE id='${challengeId}' AND status='active'`);
    if (!ch) return { breached: false, reason: 'Not active' };

    const equity = ch.current_equity || ch.current_balance;
    const balance = ch.current_balance;
    const dayStart = ch.day_start_balance || ch.starting_balance;

    // --- MAX TOTAL DRAWDOWN ---
    // Equity must never fall below: starting_balance * (1 - max_total_loss_pct / 100)
    const totalFloor = ch.starting_balance * (1 - ch.max_total_loss_pct / 100);
    if (equity <= totalFloor) {
      await this.breachChallenge(challengeId, 'MAX_TOTAL_DRAWDOWN',
        `Equity ${equity.toFixed(2)} hit total drawdown floor ${totalFloor.toFixed(2)}`);
      return { breached: true, reason: 'MAX_TOTAL_DRAWDOWN' };
    }

    // --- MAX DAILY LOSS ---
    // Daily P&L must not exceed: -(dayStartBalance * max_daily_loss_pct / 100)
    const dailyPnL = equity - dayStart;
    const dailyLimit = -(dayStart * ch.max_daily_loss_pct / 100);
    if (dailyPnL <= dailyLimit) {
      await this.breachChallenge(challengeId, 'MAX_DAILY_LOSS',
        `Daily loss ${dailyPnL.toFixed(2)} exceeded limit ${dailyLimit.toFixed(2)}`);
      return { breached: true, reason: 'MAX_DAILY_LOSS' };
    }

    // --- PROFIT TARGET CHECK ---
    const targetBalance = ch.starting_balance * (1 + ch.profit_target_pct / 100);
    if (balance >= targetBalance) {
      // Check if positions are closed (in production, query cTrader)
      return { breached: false, targetReached: true, reason: 'PROFIT_TARGET_REACHED' };
    }

    // --- INACTIVITY CHECK ---
    // Must place at least 1 trade every 30 days
    if (ch.last_trade_at) {
      const daysSinceLastTrade = (Date.now() - new Date(ch.last_trade_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastTrade >= 30) {
        await this.breachChallenge(challengeId, 'INACTIVITY',
          `No trades for ${Math.floor(daysSinceLastTrade)} days`);
        return { breached: true, reason: 'INACTIVITY' };
      }
    }

    return { breached: false };
  }

  /**
   * Breach a challenge account
   */
  async breachChallenge(challengeId, reason, details = '') {
    console.log(`[RISK ENGINE] BREACH on challenge ${challengeId}: ${reason} — ${details}`);

    // 1. Update database
    run(`UPDATE challenges SET status='failed', failed_at=datetime('now'), breach_reason=? WHERE id=?`,
      [reason, challengeId]);

    // 2. Disable on cTrader (production)
    const ch = queryOne(`SELECT ctrader_account_id FROM challenges WHERE id='${challengeId}'`);
    if (ch?.ctrader_account_id) {
      await ctrader.disableAccount(ch.ctrader_account_id, 'CLOSE_ONLY');
      await ctrader.closeAllPositions(ch.ctrader_account_id);
    }

    // 3. Audit log
    run(`INSERT INTO audit_log (id, action, entity_type, entity_id, details)
         VALUES (?, 'CHALLENGE_BREACHED', 'challenge', ?, ?)`,
      [require('uuid').v4(), challengeId, `${reason}: ${details}`]);

    // 4. Send breach notification email via SendGrid (integrate in Sprint 7)
  }

  /**
   * Pass a challenge → create funded account
   */
  async passChallenge(challengeId) {
    const ch = queryOne(`SELECT * FROM challenges WHERE id='${challengeId}' AND status='active'`);
    if (!ch) return null;

    console.log(`[RISK ENGINE] PASS on challenge ${challengeId} — creating funded account`);

    // 1. Update challenge status
    run(`UPDATE challenges SET status='passed', passed_at=datetime('now') WHERE id=?`, [challengeId]);

    // 2. Create funded account
    const fundedId = require('uuid').v4();
    const ctraderResult = await ctrader.createAccount({
      balance: ch.account_size,
      leverage: ch.leverage,
      group: 'demo_prop_funded',
    });

    run(`INSERT INTO funded_accounts (id, user_id, challenge_id, account_size, starting_balance,
         current_balance, current_equity, highest_balance, lowest_equity, day_start_balance,
         profit_split_pct, ctrader_login, ctrader_account_id, max_daily_loss_pct, max_total_loss_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fundedId, ch.user_id, challengeId, ch.account_size, ch.account_size,
       ch.account_size, ch.account_size, ch.account_size, ch.account_size, ch.account_size,
       ch.profit_split_pct, ctraderResult.login, ctraderResult.accountId,
       ch.max_daily_loss_pct, ch.max_total_loss_pct]);

    // 3. Audit log
    run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details)
         VALUES (?, ?, 'CHALLENGE_PASSED', 'challenge', ?, 'Profit target reached — funded account created')`,
      [require('uuid').v4(), ch.user_id, challengeId]);

    // 4. Send congratulations email (integrate in Sprint 7)

    return {
      funded_account_id: fundedId,
      ctrader_login: ctraderResult.login,
      ctrader_password: ctraderResult.password,
      ctrader_server: ctraderResult.server,
    };
  }

  /**
   * Check scaling eligibility for a funded account
   */
  async checkScaling(fundedAccountId) {
    const acct = queryOne(`SELECT * FROM funded_accounts WHERE id='${fundedAccountId}'`);
    if (!acct) return null;

    const nextLevel = config.scalingLevels.find(l => l.level === acct.scaling_level + 1);
    if (!nextLevel) return { eligible: false, reason: 'Already at max level' };

    const profitPct = (acct.total_profit / acct.account_size) * 100;
    const eligible = acct.payout_count >= nextLevel.required_payouts && profitPct >= nextLevel.required_profit_pct;

    return {
      eligible,
      currentLevel: acct.scaling_level,
      nextLevel: nextLevel.level,
      nextSize: acct.account_size * nextLevel.multiplier,
      nextSplit: nextLevel.split,
      payoutsNeeded: Math.max(0, nextLevel.required_payouts - acct.payout_count),
      profitNeeded: Math.max(0, nextLevel.required_profit_pct - profitPct),
    };
  }

  /**
   * Reset daily balances at server midnight
   * Run this as a daily cron job at 00:00 server time
   */
  async resetDailyBalances() {
    console.log('[RISK ENGINE] Resetting daily start balances');
    run(`UPDATE challenges SET day_start_balance = current_balance WHERE status = 'active'`);
    run(`UPDATE funded_accounts SET day_start_balance = current_balance WHERE status = 'active'`);
  }
}

module.exports = new RiskEngine();
