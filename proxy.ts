import { NextRequest, NextResponse } from "next/server";

export async function proxy(req: NextRequest) {
  const country = req.headers.get("X-Vercel-IP-Country");
  // Temporarily blocking traffic from Russia since I have too many requests from there.
  if (country === "RU") {
    return new NextResponse("Access Denied", { status: 403 });
  }

  // Allow the request to proceed
  return NextResponse.next();
}

// Optionally, specify paths to apply the proxy
export const config = {
  matcher: "/:path*", // Apply to all routes
};
