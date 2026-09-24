import { NextResponse, type NextRequest } from "next/server";

import { CENTER_COOKIE } from "@/lib/center-resolve";

/** Forget the organization chosen with the switcher and open the default community again. */
export function GET(request: NextRequest) {
  const res = NextResponse.redirect(new URL("/", request.url));
  res.cookies.delete(CENTER_COOKIE);
  return res;
}
