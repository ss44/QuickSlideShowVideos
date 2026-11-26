export type SettingsSectionId =
  | 'timing'
  | 'transitions'
  | 'effects'
  | 'music'
  | 'duplicates'
  | 'output'
  | 'about'

export interface SettingsSectionMeta {
  id: SettingsSectionId
  title: string
  mobileLabel: string
}

/**
 * Single source of truth for settings categories shared across the desktop
 * collapsible sidebar, mobile bottom tab bar, and mobile slide-out drawer.
 */
export const SETTINGS_SECTIONS: SettingsSectionMeta[] = [
  { id: 'timing', title: 'Timing', mobileLabel: 'Timing' },
  { id: 'transitions', title: 'Transitions', mobileLabel: 'Trans.' },
  { id: 'effects', title: 'Smart Effects', mobileLabel: 'Effects' },
  { id: 'music', title: 'Music', mobileLabel: 'Music' },
  { id: 'duplicates', title: 'Duplicate Finder', mobileLabel: 'Dupes' },
  { id: 'output', title: 'Output Format', mobileLabel: 'Output' },
  { id: 'about', title: 'About', mobileLabel: 'About' },
]
