import { NextResponse } from "next/server";

export function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.delete("warehouse_session");
  return response;
}
