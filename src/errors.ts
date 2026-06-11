/**
 * A validation/integrity failure caused by bad client input — NOT a server
 * fault. Carries the HTTP status the API should return so a bad foreign key
 * or a cross-client mismatch never surfaces as a 500.
 *
 *   400 -> referenced entity does not exist / malformed reference
 *   409 -> reference is valid-shaped but conflicts with existing data
 *          (e.g. a campaign that belongs to a different client)
 */
export class ValidationError extends Error {
  constructor(
    public readonly status: 400 | 409,
    message: string,
    public readonly code: string = 'validation_error',
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}
