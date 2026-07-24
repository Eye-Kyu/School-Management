import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ASSIST_MODE_COOKIE } from '@school-manager/types';

export async function POST() {
  cookies().delete(ASSIST_MODE_COOKIE);
  return NextResponse.json({ ok: true });
}
