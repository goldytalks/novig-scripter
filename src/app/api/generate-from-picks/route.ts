import { NextResponse } from 'next/server'
import { generateScript, GenerateInput } from '@/lib/generate'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const body: GenerateInput = await request.json()

    if (!body.picks?.length || !body.sport || !body.day || !body.date) {
      return NextResponse.json({ error: 'Missing required fields: picks, sport, day, date' }, { status: 400 })
    }

    const result = await generateScript(body)
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Generate error:', error)
    return NextResponse.json({ error: error.message || 'Script generation failed' }, { status: 500 })
  }
}
