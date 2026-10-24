import jwt from 'jsonwebtoken';

const MAX_TOKEN_LIFETIME_SECONDS = 300;

/**
 * Ghost requires exp <= iat + 300 (seconds, not ms) and the secret decoded
 * from hex before signing. `kid` goes in the JWT header, not the payload.
 */
export function makeGhostToken(adminApiKey: string): string {
  const [id, secret] = adminApiKey.split(':');
  if (!id || !secret) {
    throw new Error('Invalid GHOST_ADMIN_API_KEY: expected format "<id>:<secret>"');
  }

  const iat = Math.floor(Date.now() / 1000);
  return jwt.sign({ iat, exp: iat + MAX_TOKEN_LIFETIME_SECONDS, aud: '/admin/' }, Buffer.from(secret, 'hex'), {
    algorithm: 'HS256',
    keyid: id,
  });
}

export function ghostAuthHeaders(adminApiKey: string, apiVersion: string): Record<string, string> {
  return {
    Authorization: `Ghost ${makeGhostToken(adminApiKey)}`,
    'Accept-Version': apiVersion,
  };
}
