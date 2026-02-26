export interface Hook {
  id: string
  text: string        // with {day}, {sport}, {count} placeholders
  tone: 'hype' | 'controversial' | 'confident' | 'casual' | 'authoritative'
  format: 'statement' | 'question' | 'declaration'
  tags: string[]
}

export const HOOKS: Hook[] = [
  // HYPE
  {
    id: 'official-best',
    text: "It's official: {sport} {day} has the best {count} picks of the season",
    tone: 'hype', format: 'declaration', tags: ['nba', 'official', 'season']
  },
  {
    id: 'ready',
    text: "You ready? Because {sport} {day} just handed us {count} of the cleanest spots of the year",
    tone: 'hype', format: 'question', tags: ['nba', 'hype', 'clean']
  },
  {
    id: 'what-if-told-you',
    text: "What if I told you {sport} {day} has {count} picks with almost zero variance?",
    tone: 'hype', format: 'question', tags: ['nba', 'variance']
  },
  // CONTROVERSIAL
  {
    id: 'controversial-sweep',
    text: "This may be controversial: but {sport} {day} is the EASIEST path to a {count}-0 sweep with these {count} picks",
    tone: 'controversial', format: 'statement', tags: ['nba', 'sweep', 'easy']
  },
  {
    id: 'controversial-sweat-free',
    text: "This may be controversial: but these {count} picks for the {sport} on {day} are sweat free",
    tone: 'controversial', format: 'statement', tags: ['nba', 'sweat-free', 'easy']
  },
  {
    id: 'controversial-primetime',
    text: "This may be controversial: but this {sport} primetime game tonight is WAY too easy to predict",
    tone: 'controversial', format: 'statement', tags: ['nba', 'primetime', 'easy']
  },
  // CONFIDENT
  {
    id: 'marry-picks',
    text: "I might marry these {count} picks for the {sport} on {day}",
    tone: 'confident', format: 'statement', tags: ['nba', 'marriage', 'confident']
  },
  {
    id: 'lock-of-week',
    text: "I don't say this lightly — this {sport} {day} card might be the lock of the week",
    tone: 'confident', format: 'statement', tags: ['nba', 'lock']
  },
  {
    id: 'seen-enough',
    text: "I've seen enough. {sport} {day} is a {count}-leg parlay special and it's not close",
    tone: 'confident', format: 'declaration', tags: ['nba', 'parlay']
  },
  // AUTHORITATIVE
  {
    id: 'not-missing',
    text: "If you miss these {count} {sport} picks on {day}, that's on you",
    tone: 'authoritative', format: 'statement', tags: ['nba', 'urgent']
  },
  {
    id: 'numbers-dont-lie',
    text: "The numbers don't lie — {sport} on {day} is setting up the cleanest {count}-pick slate we've seen all month",
    tone: 'authoritative', format: 'statement', tags: ['nba', 'data', 'analytical']
  },
  // CASUAL
  {
    id: 'be-honest',
    text: "Be honest — you already knew {sport} {day} was going to go this way",
    tone: 'casual', format: 'statement', tags: ['nba', 'relatable']
  },
  {
    id: 'not-gonna-lie',
    text: "Not gonna lie, these {count} {sport} picks for {day} basically printed themselves",
    tone: 'casual', format: 'statement', tags: ['nba', 'easy']
  },
  {
    id: 'woke-up-chose',
    text: "Woke up, chose violence, and these {count} {sport} picks on {day} are the proof",
    tone: 'casual', format: 'statement', tags: ['nba', 'meme', 'energy']
  }
]

export function fillHook(hook: Hook, vars: { day: string; sport: string; count: number }): string {
  return hook.text
    .replace(/{day}/g, vars.day)
    .replace(/{sport}/g, vars.sport)
    .replace(/{count}/g, vars.count.toString())
}

export function getHooksByTone(tone: Hook['tone']): Hook[] {
  return HOOKS.filter(h => h.tone === tone)
}

export function getRandomHook(filter?: Partial<Pick<Hook, 'tone' | 'format'>>): Hook {
  let pool = [...HOOKS]
  if (filter?.tone) pool = pool.filter(h => h.tone === filter.tone)
  if (filter?.format) pool = pool.filter(h => h.format === filter.format)
  return pool[Math.floor(Math.random() * pool.length)]
}
