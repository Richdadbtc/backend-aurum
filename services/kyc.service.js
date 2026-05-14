const axios = require('axios');
const logger = require('../config/logger');

// Smile Identity BVN/NIN verification
async function verifyIdentity({ bvn, nin, idType, idNumber, firstName, lastName, dob }) {
  if (!process.env.SMILE_IDENTITY_API_KEY || !process.env.SMILE_IDENTITY_PARTNER_ID) {
    // Dev mode — auto-approve
    logger.warn('Smile Identity not configured — using mock approval');
    return { jobId: `MOCK-${Date.now()}`, resultCode: '0810', resultText: 'Verified', approved: true };
  }

  try {
    const payload = {
      partner_id: process.env.SMILE_IDENTITY_PARTNER_ID,
      partner_params: {
        job_id: `AV-${Date.now()}`,
        user_id: `${firstName}-${lastName}`,
        job_type: 5,
      },
      id_info: {
        first_name: firstName,
        last_name: lastName,
        dob,
        country: 'NG',
        id_type: idType === 'passport' ? 'PASSPORT' : idType === 'drivers' ? "DRIVERS_LICENSE" : 'NIN',
        id_number: idNumber || nin || bvn,
        entered: true,
      },
      options: { return_job_status: true, return_linked_consent: false },
      sec_key: process.env.SMILE_IDENTITY_API_KEY,
    };

    const { data } = await axios.post(
      'https://3eydmgh10d.execute-api.us-west-2.amazonaws.com/test/id_verification',
      payload,
      { timeout: 15000 }
    );

    const approved = data?.result?.ResultCode === '0810';
    return {
      jobId: data?.SmileJobID,
      resultCode: data?.result?.ResultCode,
      resultText: data?.result?.ResultText,
      approved,
    };
  } catch (err) {
    logger.error(`Smile Identity error: ${err.message}`);
    // On API error, queue for manual review
    return { jobId: null, resultCode: 'ERROR', resultText: err.message, approved: false, manualReview: true };
  }
}

module.exports = { verifyIdentity };
