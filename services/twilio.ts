import { TwilioConfig } from "../types";

/**
 * Initiates a call using Twilio REST API.
 * 
 * NOTE: Calling the Twilio API directly from the browser is generally blocked by CORS 
 * policies for security reasons. In a production app, this should be done via a 
 * backend server (e.g., Node.js). 
 * 
 * For this client-side assistant, this function constructs the request. 
 * If CORS fails, it provides a fallback simulation or requires a CORS proxy/extension.
 */
export const makeTwilioCall = async (
  config: TwilioConfig, 
  customerNumber: string,
  userRealPhoneNumber: string // The number to bridge the call to (your cell)
): Promise<any> => {
  if (!config.accountSid || !config.authToken || !config.myPhoneNumber) {
    throw new Error("Missing Twilio credentials");
  }

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls.json`;
  
  // TwiML to connect the user (your real phone) to the call first
  // When you pick up, it connects to the customer.
  // Ideally, this URL points to a TwiML Bin: <Response><Dial><Number>USER_REAL_PHONE</Number></Dial></Response>
  // For now, we use a placeholder or assume the user wants to call the customer directly and bridge a different way.
  
  // Standard "Click-to-Call" flow:
  // 1. Twilio calls 'From' (Your Twilio Number) -> actually, usually we call the Agent first.
  // Let's assume we call the customer directly, but we need a verified number or a SIP endpoint.
  // EASIER FLOW: Call the Customer, and provide TwiML to Dial YOU.
  
  const formData = new URLSearchParams();
  formData.append('To', customerNumber);
  formData.append('From', config.myPhoneNumber);
  
  // This TwiML tells Twilio what to do when the Customer answers.
  // We want it to dial YOUR real phone number so you can talk.
  // Note: userRealPhoneNumber must be verified in Twilio Console during trial.
  const twiml = `
    <Response>
      <Say>Please wait while we connect you to the assistant.</Say>
      <Dial>${userRealPhoneNumber}</Dial>
    </Response>
  `;
  formData.append('Twiml', twiml);

  const auth = btoa(`${config.accountSid}:${config.authToken}`);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Handle XML error response parsing if needed, usually simple text log is enough
      throw new Error(`Twilio Error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return await response.json();
  } catch (error: any) {
    // Detect CORS error
    if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
      throw new Error("CORS Error: Browser blocked the Twilio API request. Please use a CORS proxy or run this via a backend.");
    }
    throw error;
  }
};