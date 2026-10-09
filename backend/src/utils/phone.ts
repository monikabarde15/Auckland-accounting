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

  let countryToUse: CountryCode = defaultCountry;
  let cleanInput = trimmed;
  const digitsOnly = cleanInput.replace(/\D/g, '');

  // Auto-detect Indian mobile numbers if entered without '+' (e.g. 7089526977, 07089526977 or 917089526977)
  if (/^[6-9]\d{9}$/.test(digitsOnly) && !cleanInput.startsWith('+')) {
    countryToUse = 'IN';
    cleanInput = `+91${digitsOnly}`;
  } else if (/^0[6-9]\d{9}$/.test(digitsOnly) && !cleanInput.startsWith('+')) {
    countryToUse = 'IN';
    cleanInput = `+91${digitsOnly.slice(1)}`;
  } else if (/^91[6-9]\d{9}$/.test(digitsOnly) && !cleanInput.startsWith('+')) {
    countryToUse = 'IN';
    cleanInput = `+${digitsOnly}`;
  }

  try {
    const phoneNumber = parsePhoneNumberWithError(cleanInput, countryToUse);

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
  return normalizePhoneNumber(rawInput, defaultCountry).isValid;
}
