import { NextRequest, NextResponse } from 'next/server';

// Initiates Google OAuth 2.0 authorization code flow.
// Redirects the user to Google's consent screen.
export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dealtrust-portal.vercel.app';

  if (!clientId) {
    return NextResponse.json(
      { success: false, message: 'Google sign-in is not configured' },
      { status: 500 }
    );
  }

  const redirectUri = `${appUrl}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
