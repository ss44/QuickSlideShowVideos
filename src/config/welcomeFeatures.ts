export type WelcomeFeatureIcon = 'shield' | 'eye-off' | 'zap' | 'sparkles'

export interface WelcomeFeatureHighlight {
  id: string
  icon: WelcomeFeatureIcon
  title: string
  description: string
  accentClasses: string
}

export const WELCOME_TRUST_PILLS: readonly string[] = [
  'No server',
  'No uploads',
  'No tracking',
  'No sign-up',
] as const

export const WELCOME_FEATURE_HIGHLIGHTS: readonly WelcomeFeatureHighlight[] = [
  {
    id: 'files-stay-on-device',
    icon: 'shield',
    title: 'Your files never leave your device',
    description:
      'There is no server and nothing gets uploaded. Your photos and music stay right on your phone or computer the whole time.',
    accentClasses: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400',
  },
  {
    id: 'no-tracking',
    icon: 'eye-off',
    title: 'Zero tracking & no account needed',
    description:
      'No sign-ups, no ads following you around, and nobody peeking at your pictures. Just open the page and start creating.',
    accentClasses: 'border-indigo-500/25 bg-indigo-500/10 text-indigo-400',
  },
  {
    id: 'super-fast',
    icon: 'zap',
    title: 'Super fast — no waiting in line',
    description:
      'Because your own device builds the video directly, there is no slow upload bar and no server queue holding you up.',
    accentClasses: 'border-amber-500/25 bg-amber-500/10 text-amber-400',
  },
  {
    id: 'easy-slideshow-magic',
    icon: 'sparkles',
    title: 'Photos + music → ready-to-share video',
    description:
      'Drop in a bunch of photos, add smooth transitions and a song that syncs to the beat, then save your finished MP4 video.',
    accentClasses: 'border-pink-500/25 bg-pink-500/10 text-pink-400',
  },
] as const
