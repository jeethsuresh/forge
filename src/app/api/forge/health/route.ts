import { NextResponse } from "next/server";
import { getForgeHealthPayload } from "@/lib/self-update";

export async function GET() {
  return NextResponse.json(getForgeHealthPayload());
}
