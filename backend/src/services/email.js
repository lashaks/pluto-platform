// Pluto Capital Funding — Email Service via Resend
const API_KEY = process.env.EMAIL_API_KEY || '';
const FROM = process.env.EMAIL_FROM || 'Pluto Capital Funding <noreply@plutocapitalfunding.com>';

function wrap(title, content) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#06050a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#06050a;padding:40px 20px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#11101b;border-radius:16px;border:1px solid rgba(255,255,255,0.06);overflow:hidden">
  <!-- Header -->
  <tr><td style="padding:32px 40px 20px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.05)">
    <img src="https://pluto-platform.vercel.app/img/favicon.svg" alt="Pluto Capital" width="40" height="40" style="display:block;margin:0 auto 12px;border-radius:10px">
    <div style="font-size:20px;font-weight:800;color:#eeedf4;letter-spacing:-0.02em">PLUTO<span style="color:#a78bfa">CAPITAL</span></div>
    <div style="font-size:11px;color:#5a5672;letter-spacing:0.15em;margin-top:4px">FUNDING</div>
  </td></tr>
  <!-- Title -->
  <tr><td style="padding:32px 40px 8px">
    <h1 style="margin:0;font-size:24px;font-weight:800;color:#eeedf4;letter-spacing:-0.02em">${title}</h1>
  </td></tr>
  <!-- Content -->
  <tr><td style="padding:8px 40px 32px;color:#8b87a0;font-size:15px;line-height:1.7">
    ${content}
  </td></tr>
  <!-- Footer -->
  <tr><td style="padding:24px 40px;border-top:1px solid rgba(255,255,255,0.05);text-align:center">
    <p style="margin:0;font-size:12px;color:#5a5672">This is an automated message. Please do not reply to this email.</p>
    <p style="margin:4px 0 0;font-size:12px;color:#5a5672">For support, contact <a href="mailto:support@plutocapitalfunding.com" style="color:#a78bfa">support@plutocapitalfunding.com</a></p>
    <p style="margin:8px 0 0;font-size:11px;color:#3d3955">&copy; 2026 Pluto Capital Funding. All trading takes place in a simulated environment.</p>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

function btn(text, url) {
  return `<div style="text-align:center;margin:28px 0"><a href="${url}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#7c3aed,#8b5cf6);color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px">${text}</a></div>`;
}

function row(label, value) {
  return `<tr><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);color:#8b87a0;font-size:14px">${label}</td><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);color:#eeedf4;font-size:14px;font-weight:600;text-align:right;font-family:monospace">${value}</td></tr>`;
}

async function send(to, subject, html) {
  if (!API_KEY) { console.log('[Email] No API key, skipping:', subject, 'to', to); return; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    const data = await res.json();
    if (!res.ok) console.error('[Email] Failed:', data);
    else console.log('[Email] Sent:', subject, 'to', to, 'id:', data.id);
    return data;
  } catch (e) { console.error('[Email] Error:', e.message); }
}

// ============================================================
// EMAIL TEMPLATES
// ============================================================

async function sendVerification(to, name, code) {
  return send(to, 'Verify Your Email — Pluto Capital Funding', wrap(
    'Verify Your Email',
    `<p>Hey ${name},</p>
    <p>Welcome to Pluto Capital Funding. Use the code below to verify your email address and activate your account.</p>
    <div style="text-align:center;margin:28px 0">
      <div style="display:inline-block;padding:18px 48px;background:#0b0a12;border:2px solid rgba(139,92,246,0.3);border-radius:12px;font-family:monospace;font-size:32px;font-weight:700;color:#a78bfa;letter-spacing:8px">${code}</div>
    </div>
    <p>This code expires in 15 minutes. If you didn't create an account, you can safely ignore this email.</p>`
  ));
}

async function sendWelcome(to, name) {
  const dashUrl = 'https://pluto-platform.vercel.app';
  return send(to, 'Welcome to Pluto Capital Funding', wrap(
    'Welcome Aboard, ' + name + '!',
    `<p>Your Pluto Capital account is ready. Here's what you can do next:</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0">
      <tr><td style="padding:14px 16px;background:rgba(139,92,246,0.06);border-radius:10px;border:1px solid rgba(139,92,246,0.12);margin-bottom:8px">
        <strong style="color:#a78bfa">1.</strong> <span style="color:#eeedf4">Choose a Challenge</span><br>
        <span style="font-size:13px">Select between 1-Step or 2-Step evaluations, from $5K to $200K accounts.</span>
      </td></tr>
      <tr><td style="height:8px"></td></tr>
      <tr><td style="padding:14px 16px;background:rgba(52,211,153,0.06);border-radius:10px;border:1px solid rgba(52,211,153,0.12)">
        <strong style="color:#34d399">2.</strong> <span style="color:#eeedf4">Pass Your Evaluation</span><br>
        <span style="font-size:13px">Hit the profit target within the drawdown rules. No time limits. No minimum trading days.</span>
      </td></tr>
      <tr><td style="height:8px"></td></tr>
      <tr><td style="padding:14px 16px;background:rgba(96,165,250,0.06);border-radius:10px;border:1px solid rgba(96,165,250,0.12)">
        <strong style="color:#60a5fa">3.</strong> <span style="color:#eeedf4">Get Funded &amp; Earn</span><br>
        <span style="font-size:13px">Complete KYC, receive your funded account, and keep up to 80% of your profits.</span>
      </td></tr>
    </table>
    ${btn('Go to Dashboard', dashUrl)}
    <p style="font-size:13px">Your login email: <strong style="color:#eeedf4">${to}</strong></p>
    <p style="font-size:13px">Need help? Contact <a href="mailto:support@plutocapitalfunding.com" style="color:#a78bfa">support@plutocapitalfunding.com</a></p>`
  ));
}

async function sendPasswordReset(to, name, resetCode) {
  return send(to, 'Reset Your Password — Pluto Capital', wrap(
    'Reset Your Password',
    `<p>Hey ${name},</p>
    <p>We received a request to reset your password. Use the code below:</p>
    <div style="text-align:center;margin:28px 0">
      <div style="display:inline-block;padding:18px 48px;background:#0b0a12;border:2px solid rgba(139,92,246,0.3);border-radius:12px;font-family:monospace;font-size:32px;font-weight:700;color:#a78bfa;letter-spacing:8px">${resetCode}</div>
    </div>
    <p>This code expires in 15 minutes. If you didn't request a password reset, you can safely ignore this email — your password will remain unchanged.</p>`
  ));
}

async function sendChallengePurchased(to, name, details) {
  return send(to, 'Challenge Purchased — Pluto Capital', wrap(
    'Challenge Purchased!',
    `<p>Hey ${name},</p>
    <p>Your evaluation challenge has been created. Here are your details:</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid rgba(255,255,255,0.06);border-radius:10px;overflow:hidden">
      ${row('Account Size', '$' + Number(details.account_size).toLocaleString())}
      ${row('Challenge Type', details.challenge_type === 'two_step' ? '2-Step Evaluation' : '1-Step Evaluation')}
      ${row('Profit Target', details.profit_target + '%')}
      ${row('Max Daily Loss', details.daily_loss + '%')}
      ${row('Max Drawdown', details.max_drawdown + '%')}
      ${row('Profit Split', details.profit_split + '%')}
      ${row('Fee Paid', '$' + details.fee)}
    </table>
    ${details.login ? `<div style="margin:24px 0;padding:20px;background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.15);border-radius:10px">
      <div style="font-size:13px;font-weight:700;color:#a78bfa;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px">Your PlutoTrader Credentials</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${row('Login', details.login)}
        ${details.password ? row('Password', details.password) : ''}
        ${row('Server', details.server || 'PlutoCapital-Demo')}
      </table>
      <p style="font-size:12px;color:#8b87a0;margin:12px 0 0">Open PlutoTrader at <a href="${details.terminal_url || '/terminal.html'}" style="color:#a78bfa">PlutoTrader Terminal</a> and log in with your email and the password above to start trading.</p>
    </div>` : ''}
    <p><strong style="color:#fbbf24">Important Rules:</strong></p>
    <p style="font-size:13px">• 20% consistency rule applies — no single day can exceed 20% of total profit<br>
    • News trading is restricted — close positions 2 min before/after high-impact events<br>
    • 30-day inactivity = account closure<br>
    • All positions must be closed before profit target counts</p>
    ${btn('Open Dashboard', 'https://pluto-platform.vercel.app')}
    <p style="font-size:13px">Good luck, and trade with discipline!</p>`
  ));
}

async function sendChallengePassed(to, name, details) {
  return send(to, 'Congratulations! Challenge Passed — Pluto Capital', wrap(
    'You Passed! &#127881;',
    `<p>Hey ${name},</p>
    <p>Congratulations — you've successfully passed your <strong style="color:#eeedf4">${details.account_size}</strong> evaluation!</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid rgba(255,255,255,0.06);border-radius:10px;overflow:hidden">
      ${row('Final Profit', details.profit)}
      ${row('Total Trades', details.trades)}
      ${row('Win Rate', details.win_rate)}
    </table>
    <p><strong style="color:#eeedf4">Next Steps:</strong></p>
    <p>1. Complete KYC verification in your dashboard<br>
    2. Once verified, your funded account credentials will be issued<br>
    3. Start trading and request payouts anytime</p>
    ${btn('Complete KYC', 'https://pluto-platform.vercel.app')}
    <p style="font-size:13px">Welcome to the funded side. Let's go.</p>`
  ));
}

async function sendChallengeFailed(to, name, details) {
  return send(to, 'Challenge Update — Pluto Capital', wrap(
    'Challenge Breached',
    `<p>Hey ${name},</p>
    <p>Unfortunately, your <strong style="color:#eeedf4">${details.account_size}</strong> challenge has been breached.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid rgba(255,255,255,0.06);border-radius:10px;overflow:hidden">
      ${row('Breach Reason', details.reason)}
      ${row('Final Balance', details.balance)}
      ${row('Total Trades', details.trades)}
    </table>
    <p>Every trader faces setbacks. Review your trading journal, identify the mistake, and come back stronger.</p>
    ${btn('Try Again', 'https://pluto-platform.vercel.app')}
    <p style="font-size:13px">Use code <strong style="color:#a78bfa">COMEBACK15</strong> for 15% off your next challenge.</p>`
  ));
}

async function sendPayoutProcessed(to, name, details) {
  return send(to, 'Payout Processed — Pluto Capital', wrap(
    'Payout Sent! &#128176;',
    `<p>Hey ${name},</p>
    <p>Your payout has been processed and is on its way.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid rgba(255,255,255,0.06);border-radius:10px;overflow:hidden">
      ${row('Gross Profit', details.gross)}
      ${row('Your Split', details.split + '%')}
      ${row('Payout Amount', details.amount)}
      ${row('Method', details.method)}
      ${details.tx_ref ? row('TX Reference', details.tx_ref) : ''}
    </table>
    <p>Crypto payouts typically arrive within 1-2 hours. Bank transfers take 1-3 business days.</p>
    ${btn('View Payouts', 'https://pluto-platform.vercel.app')}
    <p style="font-size:13px">Keep trading and keep earning. We're rooting for you.</p>`
  ));
}

async function sendLoginAlert(to, name, details) {
  const { ip, location, device, time } = details;
  const isUnknown = !location || location === 'Unknown';
  return send(to, 'New Login Detected — Pluto Capital Funding', wrap(
    'New Sign-In to Your Account',
    `<p>Hey ${name},</p>
    <p>We detected a new login to your Pluto Capital account. If this was you, no action is needed.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid rgba(255,255,255,0.06);border-radius:10px;overflow:hidden">
      ${row('Time', time)}
      ${row('IP Address', ip || 'Unknown')}
      ${row('Location', location || 'Unknown')}
      ${row('Device', device || 'Unknown')}
    </table>
    <div style="margin:24px 0;padding:16px 20px;background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.15);border-radius:10px">
      <p style="margin:0;font-size:14px;color:#fbbf24;font-weight:700">&#9888; Not you?</p>
      <p style="margin:8px 0 0;font-size:13px;color:#8b87a0">If you did not sign in, your account may be compromised. Change your password immediately and contact us at <a href="mailto:support@plutocapitalfunding.com" style="color:#a78bfa">support@plutocapitalfunding.com</a></p>
    </div>
    ${btn('Secure My Account', 'https://pluto-platform.vercel.app')}`
  ));
}

module.exports = {
  sendVerification,
  sendWelcome,
  sendPasswordReset,
  sendChallengePurchased,
  sendChallengePassed,
  sendChallengeFailed,
  sendPayoutProcessed,
  sendLoginAlert,
  // General purpose email for risk engine
  sendGeneral: async (to, name, { subject, heading, body, cta_text, cta_url }) => {
    return send(to, subject, wrap(name,
      `<h2 style="margin:0 0 16px;font-size:1.2rem;font-weight:700">${heading}</h2>
       <p style="font-size:14px;color:#8b87a0;line-height:1.7">${body.replace(/\n/g,'<br>')}</p>
       ${cta_text ? btn(cta_text, cta_url||'https://pluto-platform.vercel.app') : ''}`
    ));
  },
};
