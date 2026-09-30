import twilio from 'twilio';
import { env } from '../../config/env.js';
import { logger } from '../../middleware/logger.js';

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

  constructor() {
    this.isLiveEnabled = env.ENABLE_LIVE_CALLING;
    this.accountSid = env.TWILIO_ACCOUNT_SID;
    this.authToken = env.TWILIO_AUTH_TOKEN;
    this.defaultCallerId = env.TWILIO_PHONE_NUMBER || '+17372508034';
    this.webhookBaseUrl = env.TWILIO_WEBHOOK_BASE_URL || env.BASE_URL;

    if (this.isLiveEnabled) {
      if (this.accountSid && this.authToken) {
        this.client = twilio(this.accountSid, this.authToken);
        logger.info('Twilio Live Client initialized with credentials');
      } else {
        logger.error(
          'ENABLE_LIVE_CALLING is true, but TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is missing. Outbound calls will be blocked!'
        );
      }
    } else {
      logger.info('Twilio Service running in SIMULATION/MOCK mode (ENABLE_LIVE_CALLING=false)');
    }
  }

  /**
   * Returns current live calling safety status.
   */
  public isLiveCallingActive(): boolean {
    return this.isLiveEnabled && Boolean(this.client);
  }

  /**
   * Creates an outbound call through Twilio or simulated provider.
   */
  public async createOutboundCall(options: CreateCallOptions): Promise<CreateCallResult> {
    const callerId = options.from || this.defaultCallerId;
    const webhookBase = this.webhookBaseUrl.replace(/\/+$/, '');
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
        '[SIMULATION] Twilio simulated outbound call initiated'
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

    // LIVE MODE
    if (!this.client || !this.accountSid || !this.authToken) {
      throw new Error('Twilio credentials missing while ENABLE_LIVE_CALLING=true. Call aborted.');
    }

    try {
      logger.info(
        { to: options.to, callerId, callAttemptId: options.callAttemptId },
        '[LIVE TWILIO] Creating real PSTN outbound call'
      );

      const call = await this.client.calls.create({
        to: options.to,
        from: callerId || env.TWILIO_PHONE_NUMBER || '+17372508034',
        url: twimlUrl,
        statusCallback: statusCallback,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
      });

      logger.info(
        { callSid: call.sid, status: call.status, to: options.to },
        '[LIVE TWILIO] Outbound call successfully placed'
      );

      return {
        providerCallId: call.sid,
        status: call.status === 'queued' ? 'queued' : 'initiated',
        isSimulated: false,
        providerDetails: {
          callSid: call.sid,
          accountSid: call.accountSid,
          direction: call.direction,
          status: call.status
        }
      };
    } catch (error) {
      const err = error as Error;
      logger.error(
        { error: err.message, to: options.to, callAttemptId: options.callAttemptId },
        '[LIVE TWILIO] Failed to place outbound call'
      );
      throw error;
    }
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
