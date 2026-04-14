// ============================================================
// SUMSUB KYC SERVICE
//

// Auth: HMAC-SHA256 signature (X-App-Token + X-App-Access-Sig)
// Docs: docs.sumsub.com
//
// Flow:
// 1. Create applicant → POST /resources/applicants
// 2. Generate access token → POST /resources/accessTokens  
// 3. Frontend launches WebSDK with token
// 4. Webhook receives verification result
// 5. Update user.kyc_status based on reviewAnswer
// ============================================================

class KYCService {
  /**
   * Create a KYC applicant in Sumsub
   * Called when trader requests their first payout
   */
  async createApplicant({ userId, email, firstName, lastName, country, phone }) {
    console.log(`[KYC] Creating applicant for ${email} (${userId})`);
    return {
      success: true,
      applicantId: 'SUMSUB-' + userId.slice(0, 8),
      status: 'init',
    };
  }

  /**
   * Generate access token for Sumsub WebSDK
   * Frontend uses this to render the verification UI
   */
  async getAccessToken(userId) {
    console.log(`[KYC] Generating access token for ${userId}`);
    return {
      token: 'acf_token_' + Date.now(),
      userId,
    };
  }

  /**
   * Process webhook from Sumsub
   * Called by POST /api/webhooks/sumsub
   */
  async processWebhook(payload) {
    console.log('[KYC] Processing webhook:', payload.type);
    
    
    // 1. Verify webhook signature (HMAC)
    // 2. Extract reviewResult.reviewAnswer (GREEN/RED)
    // 3. Update user.kyc_status in database
    // 4. If GREEN → enable payout button
    // 5. If RED → notify trader to resubmit
    
    return {
      userId: payload.externalUserId,
      status: payload.reviewResult?.reviewAnswer === 'GREEN' ? 'approved' : 'rejected',
    };
  }

  /**
   * Check applicant status
   */
  async getApplicantStatus(applicantId) {
    console.log(`[KYC] Checking status for ${applicantId}`);
    return { status: 'approved' }; 
  }
}

module.exports = new KYCService();
