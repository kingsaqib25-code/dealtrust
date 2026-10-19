import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SignJWT } from 'jose';
import crypto from 'crypto';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);

interface GoogleTokenResponse {
  access_token: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  email_verified?: boolean;
}

// Handles Google OAuth 2.0 callback: exchanges the code for tokens,
// fetches the user's profile, finds or creates the user, and issues our JWT.
export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dealtrust-portal.vercel.app';

  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error || !code) {
      return NextResponse.redirect(`${appUrl}/login?error=google_${error || 'no_code'}`);
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return NextResponse.redirect(`${appUrl}/login?error=google_not_configured`);
    }

    const redirectUri = `${appUrl}/api/auth/google/callback`;

    // Exchange authorization code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenRes.ok) {
      console.error('Google token exchange failed:', await tokenRes.text());
      return NextResponse.redirect(`${appUrl}/login?error=google_token_failed`);
    }

    const tokens = (await tokenRes.json()) as GoogleTokenResponse;

    // Fetch user profile
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userRes.ok) {
      console.error('Google userinfo failed:', await userRes.text());
      return NextResponse.redirect(`${appUrl}/login?error=google_profile_failed`);
    }

    const gUser = (await userRes.json()) as GoogleUserInfo;
    if (!gUser.email) {
      return NextResponse.redirect(`${appUrl}/login?error=google_no_email`);
    }

    const email = gUser.email.toLowerCase().trim();

    // Find existing user or create a new affiliate
    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      const randomPassword = crypto.randomBytes(32).toString('hex');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bcrypt = require('bcryptjs') as typeof import('bcryptjs');
      const hashed = await bcrypt.hash(randomPassword, 10);

      user = await prisma.user.create({
        data: {
          email,
          name: gUser.name || email.split('@')[0],
          password: hashed,
          role: 'AFFILIATE',
          status: 'ACTIVE',
          profilePicture: gUser.picture || null,
        },
      });

      // Create affiliate profile for the new user
      const cleanName = (gUser.name || 'USER').replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 6);
      const referralCode = `${cleanName}-${crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4)}`;
      await prisma.affiliate.create({
        data: {
          userId: user.id,
          referralCode,
        },
      });
    } else if (user.status !== 'ACTIVE') {
      // Auto-activate Google-verified users
      user = await prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE' },
      });
    }

    // Issue our session JWT
    const token = await new SignJWT({
      userId: user.id,
      email: user.email,
      role: user.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(JWT_SECRET);

    // Set session cookie and redirect to the right dashboard
    const dashboard = user.role === 'ADMIN' ? '/admin' : user.role === 'PARTNER_COMPANY' ? '/partner' : '/affiliate';
    const response = NextResponse.redirect(`${appUrl}${dashboard}`);
    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60,
      path: '/',
    });
    return response;
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    return NextResponse.redirect(`${appUrl}/login?error=google_failed`);
  }
}
