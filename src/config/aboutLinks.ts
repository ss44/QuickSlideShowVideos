export type AboutLinkIcon = 'github' | 'bluesky' | 'website'

export interface AboutLinkItem {
  id: string
  label: string
  sublabel: string
  href: string
  icon: AboutLinkIcon
  /** Optional status pill shown beside the link label (e.g. before a dedicated page launches). */
  badge?: string
}

export const ABOUT_LINKS: readonly AboutLinkItem[] = [
  {
    id: 'github',
    label: 'GitHub Repository',
    sublabel: 'ss44/QuickSlideShowVideos',
    href: 'https://github.com/ss44/QuickSlideShowVideos',
    icon: 'github',
  },
  {
    id: 'bluesky',
    label: 'Bluesky',
    sublabel: '@shindasingh.com',
    href: 'https://bsky.app/profile/shindasingh.com',
    icon: 'bluesky',
  },
  {
    id: 'ss44-project',
    label: 'Project Page',
    // Point directly to the Quick Slide Show project page once published on ss44.ca.
    sublabel: 'ss44.ca',
    href: 'https://ss44.ca',
    icon: 'website',
    badge: 'Coming soon',
  },
]
