import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
    process.env.JWT_SECRET!
);

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // 1. Define protected routes
    const isAdminRoute = pathname.startsWith('/api/admin') || pathname.startsWith('/admin');
    const isAffiliateRoute = pathname.startsWith('/api/affiliate') || pathname.startsWith('/affiliate');
    // B2B partnership portal: partner-company users get their own scoped area.
    const isPartnerRoute = pathname.startsWith('/api/partner') || pathname.startsWith('/partner');
    // /api/auth/me must also go through token verification + header injection
    // (the useAuth hook depends on it); it has no role restriction of its own.
    const isAuthMeRoute = pathname === '/api/auth/me';

    if (!isAdminRoute && !isAffiliateRoute && !isPartnerRoute && !isAuthMeRoute) {
        return NextResponse.next();
    }

    // 2. Get token from cookies
    const token = request.cookies.get('auth-token')?.value;

    if (!token) {
        // If it's an API route, return 401
        if (pathname.startsWith('/api/')) {
            return NextResponse.json(
                { error: 'Authentication required' },
                { status: 401 }
            );
        }
        // If it's a page route, redirect to login
        return NextResponse.redirect(new URL('/login', request.url));
    }

    try {
        // 3. Verify JWT
        const { payload } = await jwtVerify(token, JWT_SECRET);
        const userRole = payload.role as string;

        // 4. Role-based access control
        if (isAdminRoute && userRole !== 'ADMIN') {
            if (pathname.startsWith('/api/')) {
                return NextResponse.json(
                    { error: 'Forbidden: Admin access required' },
                    { status: 403 }
                );
            }
            return NextResponse.redirect(new URL('/login', request.url));
        }

        if (isAffiliateRoute && userRole !== 'AFFILIATE' && userRole !== 'ADMIN') {
            if (pathname.startsWith('/api/')) {
                return NextResponse.json(
                    { error: 'Forbidden: Affiliate access required' },
                    { status: 403 }
                );
            }
            return NextResponse.redirect(new URL('/login', request.url));
        }

        // Partner-company users see ONLY their own company's data; scoping is
        // enforced per-route via requirePartnerCompany(). Admins may also
        // enter for support/debugging.
        if (isPartnerRoute && userRole !== 'PARTNER_COMPANY' && userRole !== 'ADMIN') {
            if (pathname.startsWith('/api/')) {
                return NextResponse.json(
                    { error: 'Forbidden: Partner company access required' },
                    { status: 403 }
                );
            }
            return NextResponse.redirect(new URL('/login', request.url));
        }

        // 5. Inject user info into the downstream REQUEST headers for API routes.
        // (Must be set on request headers — response headers are invisible to route handlers.)
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set('x-user-id', payload.userId as string);
        requestHeaders.set('x-user-role', userRole);

        return NextResponse.next({
            request: { headers: requestHeaders },
        });
    } catch (error) {
        if (pathname.startsWith('/api/')) {
            return NextResponse.json(
                { error: 'Invalid or expired token' },
                { status: 401 }
            );
        }
        return NextResponse.redirect(new URL('/login', request.url));
    }
}

// See "Matching Paths" below to learn more
export const config = {
    matcher: [
        '/admin/:path*',
        '/affiliate/:path*',
        '/partner/:path*',
        '/api/admin/:path*',
        '/api/affiliate/:path*',
        '/api/partner/:path*',
        '/api/auth/me',
    ],
};
