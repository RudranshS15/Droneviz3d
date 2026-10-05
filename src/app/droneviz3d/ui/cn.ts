/**
 * cn — class-name join for the copy-paste components under ./ui.
 *
 * Those components are adapted from open-source registries (Magic UI, MIT) that
 * assume a shadcn-style project: they import `cn` from `@/lib/utils` and lean on
 * CSS variables for theming. DroneViz3D has neither, so this file is the seam —
 * one merge helper the adapted sources share, so the same class string can carry
 * a caller's override without a Tailwind conflict (a later `p-6` beating an
 * earlier `p-4` only if the merge understands Tailwind, which `twMerge` does).
 */

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}