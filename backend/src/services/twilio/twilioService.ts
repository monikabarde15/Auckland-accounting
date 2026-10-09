import twilio from 'twilio';
import { env } from '../../config/env.js';
import { logger } from '../../middleware/logger.js';
import { getCanonicalWebhookBase } from '../ivr/ivrEngine.js';
import { normalizePhoneNumber } from '../../utils/phone.js';

export interface CreateCallOptions {
  to: string; // E.164 phone number
  from?: string;
  callAttemptId: string;
  campaignId: string;
  contactId: string;
  questionnaireId: string;
  statusCallbackUrl?: string;
  twimlUrl?: string;
  timeoutSeconds?: number;
}

export interface CreateCallResult {
  providerCallId: string; // Twilio CallSid or Mock CallSid
  status: 'queued' | 'initiated' | 'failed';
  isSimulated: boolean;
  providerDetails?: Record<string, unknown>;
}

export class TwilioService {
  private client: twilio.Twilio | null = null;
  private isLiveEnabled: boolean;
  private accountSid?: string;
  private authToken?: string;
  private defaultCallerId?: string;
  private webhookBaseUrl: string;
  private telnyxApiKey?: string;
  private telnyxPhoneNumber?: string;
  private telnyxConnectionId?: string;

  constructor() {
    this.accountSid = env.TWILIO_ACCOUNT_SID;
    this.authToken = env.TWILIO_AUTH_TOKEN;
    this.telnyxApiKey = env.TELNYX_API_KEY || process.env.TELNYX_API_KEY;
    this.telnyxPhoneNumber = env.TELNYX_PHONE_NUMBER || process.env.TELNYX_PHONE_NUMBER || '+15739662167';
    this.telnyxConnectionId = env.TELNYX_CONNECTION_ID || process.env.TELNYX_CONNECTION_ID || '3066793306651362746';
    this.isLiveEnabled = env.ENABLE_LIVE_CALLING || Boolean(this.accountSid && this.authToken) || Boolean(this.telnyxApiKey);
    this.defaultCallerId = this.telnyxPhoneNumber || env.TWILIO_PHONE_NUMBER || '';
    this.webhookBaseUrl = env.TWILIO_WEBHOOK_BASE_URL || env.BASE_URL;

    if (this.isLiveEnabled) {
      if (this.telnyxApiKey) {
        logger.info({ telnyxPhone: this.telnyxPhoneNumber }, 'Telnyx Live Telephony initialized with API Key');
      }
      if (this.accountSid && this.authToken) {
        this.client = twilio(this.accountSid, this.authToken);
        logger.info('Twilio Live Client initialized with credentials');
      }
    } else {
      logger.info('Telephony Service running in SIMULATION/MOCK mode');
    }
  }

  /**
   * Returns current live calling safety status.
   */
  public isLiveCallingActive(): boolean {
    return this.isLiveEnabled && (Boolean(this.telnyxApiKey) || (Boolean(this.client)));
  }

  /**
   * Creates an outbound call through Telnyx, Twilio or simulated provider.
   */
  public async createOutboundCall(options: CreateCallOptions): Promise<CreateCallResult> {
    const callerId = options.from || this.telnyxPhoneNumber || env.TWILIO_PHONE_NUMBER || this.defaultCallerId;
    const webhookBase = getCanonicalWebhookBase();
    const twimlUrl = options.twimlUrl || `${webhookBase}/api/voice/twiml?callAttemptId=${encodeURIComponent(options.callAttemptId)}`;
    const statusCallback = options.statusCallbackUrl || `${webhookBase}/api/voice/status?callAttemptId=${encodeURIComponent(options.callAttemptId)}`;

    // Safety Gate Check: Simulation vs Live (tests always simulate to protect live credentials & mock numbers)
    if (!this.isLiveEnabled || process.env.NODE_ENV === 'test') {
      const mockCallSid = `CA_SIM_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      logger.info(
        {
          mockCallSid,
          to: options.to,
          callerId,
          callAttemptId: options.callAttemptId,
          isSimulated: true
        },
        '[SIMULATION] Telephony simulated outbound call initiated'
      );

      return {
        providerCallId: mockCallSid,
        status: 'initiated',
        isSimulated: true,
        providerDetails: {
          mockProvider: 'ACULA_TELEPHONY_SIMULATOR',
          to: options.to,
          from: callerId,
          twimlUrl,
          statusCallback
        }
      };
    }

    const normalizedTo = normalizePhoneNumber(options.to).e164 || options.to;
    let telnyxError: Error | null = null;

    // 1. ATTEMPT TELNYX (if configured)
    if (this.telnyxApiKey) {
      try {
        const fromNum = this.telnyxPhoneNumber || callerId || '+15739662167';
        const clientState = Buffer.from(JSON.stringify({
          callAttemptId: options.callAttemptId,
          campaignId: options.campaignId,
          contactId: options.contactId,
          questionnaireId: options.questionnaireId
        })).toString('base64');

        logger.info({ to: normalizedTo, from: fromNum }, '[TELNYX] Attempting outbound call');
        const telnyxRes = await fetch('https://api.telnyx.com/v2/calls', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.telnyxApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            to: normalizedTo,
            from: fromNum,
            connection_id: this.telnyxConnectionId,
            client_state: clientState
          })
        });

        const telnyxData = await telnyxRes.json() as any;
        if (telnyxRes.ok && telnyxData?.data) {
          const callControlId = telnyxData.data.call_control_id || telnyxData.data.call_leg_id;
          logger.info(
            { callControlId, to: normalizedTo, status: 'initiated' },
            '[LIVE TELNYX] Outbound call placed successfully'
          );
          return {
            providerCallId: callControlId,
            status: 'initiated',
            isSimulated: false,
            providerDetails: {
              provider: 'TELNYX',
              ...telnyxData.data
            }
          };
        } else {
          const errDetail = telnyxData?.errors?.[0]?.detail || telnyxData?.errors?.[0]?.title || `Telnyx HTTP ${telnyxRes.status}`;
          telnyxError = new Error(`[Telnyx] ${errDetail}`);
          logger.warn({ error: telnyxError.message, to: normalizedTo }, 'Telnyx call failed, attempting Twilio fallback');
        }
      } catch (tErr) {
        telnyxError = tErr as Error;
        logger.warn({ error: telnyxError.message }, 'Telnyx request exception, attempting Twilio fallback');
      }
    }

    // 2. ATTEMPT TWILIO (or fallback)
    if (this.client && this.accountSid && this.authToken) {
      try {
        const fromNumber = env.TWILIO_PHONE_NUMBER || callerId || this.defaultCallerId;
        if (!fromNumber) {
          throw new Error('Twilio caller ID (TWILIO_PHONE_NUMBER) is not configured.');
        }

        let inlineTwiml: string | undefined = undefined;
        try {
          if (options.callAttemptId) {
            const { voiceWebhookService } = await import('../voiceWebhookService.js');
            inlineTwiml = await voiceWebhookService.handleCallConnect(options.callAttemptId, undefined, {});
          }
        } catch (err) {
          logger.warn({ error: (err as Error).message }, 'Pre-rendering inline TwiML failed, will use webhook URL');
        }

        const callParams: any = {
          to: normalizedTo,
          from: fromNumber,
          statusCallback: statusCallback,
          statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
        };

        if (inlineTwiml && inlineTwiml.includes('<Response>')) {
          callParams.twiml = inlineTwiml;
        } else {
          callParams.url = twimlUrl;
        }

        const call = await this.client.calls.create(callParams);

        logger.info(
          { callSid: call.sid, status: call.status, to: options.to, hasInlineTwiml: Boolean(callParams.twiml) },
          '[LIVE TWILIO] Outbound call successfully placed'
        );

        return {
          providerCallId: call.sid,
          status: call.status === 'queued' ? 'queued' : 'initiated',
          isSimulated: false,
          providerDetails: {
            provider: 'TWILIO',
            callSid: call.sid,
            accountSid: call.accountSid,
            direction: call.direction,
            status: call.status
          }
        };
      } catch (error) {
        const err = error as Error;
        const combinedError = telnyxError
          ? `${telnyxError.message} | Twilio: ${err.message}`
          : err.message;
        logger.error(
          { error: combinedError, to: options.to, callAttemptId: options.callAttemptId },
          '[LIVE TELEPHONY] Outbound call failed on both carriers'
        );
        throw new Error(combinedError);
      }
    }

    if (telnyxError) {
      throw telnyxError;
    }

    throw new Error('No live telephony provider configured (Telnyx API key or Twilio credentials missing).');
  }

  /**
   * Validates Twilio cryptographic webhook signature (X-Twilio-Signature).
   */
  public validateWebhookSignature(
    signature: string | undefined,
    url: string,
    params: Record<string, string>
  ): boolean {
    // In simulation or test environment, accept test signatures
    if (!this.isLiveEnabled || !this.authToken || process.env.NODE_ENV === 'test') {
      return true;
    }

    if (!signature) {
      logger.warn({ url }, 'Missing X-Twilio-Signature header');
      return false;
    }

    try {
      return twilio.validateRequest(this.authToken, signature, url, params);
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Error validating Twilio signature');
      return false;
    }
  }
}

export const twilioService = new TwilioService();
