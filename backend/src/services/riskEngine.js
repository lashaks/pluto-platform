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
    const ch = await queryOne(`SELECT * FROM challenges WHERE id=$1 AND status='active'`, [challengeId]);
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
    run(`UPDATE challenges SET status='failed', failed_at=NOW()::TEXT, breach_reason=? WHERE id=?`,
      [reason, challengeId]);

    // 2. Disable on cTrader (production)
    const ch = await queryOne(`SELECT ctrader_account_id FROM challenges WHERE id=$1`, [challengeId]);
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
   * Pass a challenge → create Phase 2 (for 2-Step) or funded account
   */
  async passChallenge(challengeId) {
    const ch = await queryOne(`SELECT * FROM challenges WHERE id=$1 AND status='active'`, [challengeId]);
    if (!ch) return null;

    const email = require('../services/email');
    const usr = await queryOne(`SELECT first_name, email FROM users WHERE id=$1`, [ch.user_id]);

    // Check if this is a 2-Step Phase 1 — if so, create Phase 2 instead of funded account
    if (ch.challenge_type === 'two_step' && (ch.phase === 1 || !ch.phase)) {
      console.log(`[RISK ENGINE] 2-STEP PHASE 1 PASSED on ${challengeId} — creating Phase 2`);

      await run(`UPDATE challenges SET status='passed', passed_at=NOW()::TEXT WHERE id=?`, [challengeId]);

      // Create Phase 2 challenge
      const phase2Id = require('uuid').v4();
      const phase2Target = config.twoStepRules.phase2_target_pct;
      const ctraderResult = await ctrader.createAccount({
        balance: ch.account_size,
        leverage: ch.leverage,
        group: 'demo_prop_evaluation',
      });

      await run(`INSERT INTO challenges (id, user_id, account_size, challenge_type, phase, parent_challenge_id,
           starting_balance, current_balance, current_equity, highest_balance, lowest_equity, day_start_balance,
           fee_paid, profit_split_pct, leverage, profit_target_pct, max_daily_loss_pct, max_total_loss_pct,
           ctrader_login, ctrader_account_id, ctrader_server, status, activated_at)
           VALUES (?, ?, ?, 'two_step', 2, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW()::TEXT)`,
        [phase2Id, ch.user_id, ch.account_size, challengeId,
         ch.account_size, ch.account_size, ch.account_size, ch.account_size, ch.account_size, ch.account_size,
         ch.profit_split_pct, ch.leverage, phase2Target, ch.max_daily_loss_pct, ch.max_total_loss_pct,
         ctraderResult.login, ctraderResult.accountId, ctraderResult.server]);

      await run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details)
           VALUES (?, ?, 'PHASE1_PASSED', 'challenge', ?, 'Phase 1 passed — Phase 2 created')`,
        [require('uuid').v4(), ch.user_id, challengeId]);

      // Email: Phase 1 passed, Phase 2 starting
      if (usr) {
        email.sendChallengePassed(usr.email, usr.first_name || 'Trader', {
          account_size: '$' + Number(ch.account_size).toLocaleString(),
          profit: '$' + (ch.current_balance - ch.starting_balance).toFixed(2),
          trades: String(ch.total_trades),
          win_rate: ch.total_trades ? Math.round(ch.winning_trades / ch.total_trades * 100) + '%' : '0%',
        }).catch(e => console.error('[RiskEngine] Email error:', e.message));
      }

      return { phase2_created: true, phase2_id: phase2Id, ctrader_login: ctraderResult.login };
    }

    // Either 1-Step or 2-Step Phase 2 passed → create funded account
    console.log(`[RISK ENGINE] PASS on challenge ${challengeId} — creating funded account`);

    await run(`UPDATE challenges SET status='passed', passed_at=NOW()::TEXT WHERE id=?`, [challengeId]);

    const fundedId = require('uuid').v4();
    const ctraderResult = await ctrader.createAccount({
      balance: ch.account_size,
      leverage: ch.leverage,
      group: 'demo_prop_funded',
    });

    await run(`INSERT INTO funded_accounts (id, user_id, challenge_id, account_size, starting_balance,
         current_balance, current_equity, highest_balance, lowest_equity, day_start_balance,
         profit_split_pct, ctrader_login, ctrader_account_id, max_daily_loss_pct, max_total_loss_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fundedId, ch.user_id, challengeId, ch.account_size, ch.account_size,
       ch.account_size, ch.account_size, ch.account_size, ch.account_size, ch.account_size,
       ch.profit_split_pct, ctraderResult.login, ctraderResult.accountId,
       ch.max_daily_loss_pct, ch.max_total_loss_pct]);

    await run(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details)
         VALUES (?, ?, 'CHALLENGE_PASSED', 'challenge', ?, 'Profit target reached — funded account created')`,
      [require('uuid').v4(), ch.user_id, challengeId]);

    // Send congratulations email
    if (usr) {
      email.sendChallengePassed(usr.email, usr.first_name || 'Trader', {
        account_size: '$' + Number(ch.account_size).toLocaleString(),
        profit: '$' + (ch.current_balance - ch.starting_balance).toFixed(2),
        trades: String(ch.total_trades),
        win_rate: ch.total_trades ? Math.round(ch.winning_trades / ch.total_trades * 100) + '%' : '0%',
      }).catch(e => console.error('[RiskEngine] Email error:', e.message));
    }

    return {
      funded_account_id: fundedId,
      ctrader_login: ctraderResult.login,
      ctrader_password: ctraderResult.password,
      ctrader_server: ctraderResult.server,
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

  /**
   * Check a funded account for breaches (no profit target on funded — just risk rules)
   */
  async checkFundedAccount(fundedId) {
    const fa = await queryOne(`SELECT * FROM funded_accounts WHERE id=$1 AND status='active'`, [fundedId]);
    if (!fa) return { breached: false, reason: 'Not active' };

    const equity = fa.current_equity || fa.current_balance;
    const dayStart = fa.day_start_balance || fa.starting_balance;

    // Max total drawdown (from starting_balance)
    const totalFloor = fa.starting_balance * (1 - fa.max_total_loss_pct / 100);
    if (equity <= totalFloor) {
      await run(`UPDATE funded_accounts SET status='breached', breach_reason='MAX_TOTAL_DRAWDOWN', breached_at=NOW()::TEXT WHERE id=?`, [fundedId]);
      return { breached: true, reason: 'MAX_TOTAL_DRAWDOWN' };
    }

    // Daily loss
    const dailyPnL = equity - dayStart;
    const dailyLimit = -(dayStart * fa.max_daily_loss_pct / 100);
    if (dailyPnL <= dailyLimit) {
      await run(`UPDATE funded_accounts SET status='breached', breach_reason='MAX_DAILY_LOSS', breached_at=NOW()::TEXT WHERE id=?`, [fundedId]);
      return { breached: true, reason: 'MAX_DAILY_LOSS' };
    }

    return { breached: false };
  }
}

module.exports = new RiskEngine();
