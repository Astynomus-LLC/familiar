export interface OAuthUser {
  id: string;
  username: string;
  avatar: string | null;
}
export interface OAuthProvider {
  exchange(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ): Promise<OAuthUser>;
}

export const discordOAuth: OAuthProvider = {
  async exchange(code, clientId, clientSecret, redirectUri) {
    const response = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error(
        'Discord login failed. Check the OAuth secret and redirect URL.',
      );
    const token = (await response.json()) as { access_token: string };
    const identity = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!identity.ok)
      throw new Error(
        'Could not read your Discord identity. Try signing in again.',
      );
    return identity.json() as Promise<OAuthUser>;
  },
};
