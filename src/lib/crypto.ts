import crypto from 'crypto';

/** 64-char hex token, 256 bits of entropy. Used for mcp_auth_code / mcp tokens. */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** SHA-256 hex digest. */
export function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
