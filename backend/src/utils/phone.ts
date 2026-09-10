import { parsePhoneNumberWithError, isValidPhoneNumber, CountryCode } from 'libphonenumber-js';

export interface PhoneNormalizationResult {
  isValid: boolean;
  e164: string;
  national: string;
  country?: string;
  formatted?: string;
  error?: string;
}

/**
 * Normalizes any user or CSV input phone number to canonical E.164 format.
 * Defaults to New Zealand ('NZ') for local numbers like '021 123 4567' or '09 837 0000'.
 */
export function normalizePhoneNumber(
  rawInput: string | null | undefined,
  defaultCountry: CountryCode = 'NZ'
): PhoneNormalizationResult {
  if (!rawInput || typeof rawInput !== 'string') {
    return {
      isValid: false,
      e164: '',
      national: '',
      error: 'Phone number is required'
    };
  }

  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      isValid: false,
      e164: '',
      national: '',
      error: 'Phone number cannot be blank'
    };
  }

  try {
    const phoneNumber = parsePhoneNumberWithError(trimmed, defaultCountry);

    if (!phoneNumber.isValid()) {
      return {
        isValid: false,
        e164: trimmed,
        national: trimmed,
        error: `Invalid phone number format for country ${phoneNumber.country || defaultCountry}`
      };
    }

    return {
      isValid: true,
      e164: phoneNumber.format('E.164'), // e.g. +64211234567
      national: phoneNumber.formatNational(), // e.g. 021 123 4567
      country: phoneNumber.country,
      formatted: phoneNumber.formatInternational() // e.g. +64 21 123 4567
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Invalid phone number';
    return {
      isValid: false,
      e164: trimmed,
      national: trimmed,
      error: errorMessage
    };
  }
}

/**
 * Fast boolean check for phone number validity
 */
export function isPhoneNumberValid(rawInput: string, defaultCountry: CountryCode = 'NZ'): boolean {
  if (!rawInput || typeof rawInput !== 'string') return false;
  return isValidPhoneNumber(rawInput.trim(), defaultCountry);
}
