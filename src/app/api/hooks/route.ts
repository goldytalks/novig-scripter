import { NextResponse } from 'next/server'
import { HOOKS, getHooksByTone } from '@/lib/hooks'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tone = searchParams.get('tone')

  if (tone) {
    return NextResponse.json(getHooksByTone(tone as any))
  }
  return NextResponse.json(HOOKS)
}
