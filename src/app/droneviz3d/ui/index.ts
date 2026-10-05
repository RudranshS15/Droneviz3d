/**
 * Adapted open-source UI components used across DroneViz3D.
 *
 * Every file in this directory is a copy-paste component from a free,
 * open-source registry — not a dependency — and each one carries a header naming
 * its source, its licence (MIT) and exactly what was changed for this project.
 * The registries these come from are built for shadcn + Tailwind 4; this app is
 * plain Tailwind 3 with no shadcn theme layer, so the adaptations are mostly
 * syntax and the removal of CSS variables the app does not define.
 *
 * Why copy instead of install a library: these are decorative, and a copy can be
 * held to this project's rules — dark-only colours, `motion-safe:` for anything
 * animated, `aria-hidden` on every purely-visual layer, and no dependency on a
 * theme this app does not have.
 *
 * Licensing note: the registries these were taken from (21st.dev, OriginKit,
 * ThreeUI, curated.design, recent.design) either gate their own code behind
 * sign-in or a paid licence. The components below come from the MIT-licensed
 * projects those sites also host, fetched from the projects' own public
 * registries, so the licence is clear and the attribution is real.
 */

export { AnimatedShinyText } from './animated-shiny-text'
export { BlurFade } from './blur-fade'
export { BorderBeam } from './border-beam'
export { GridPattern } from './grid-pattern'
export { NumberTicker } from './number-ticker'
export { PulsatingButton } from './pulsating-button'
export { ShineBorder } from './shine-border'
export { cn } from './cn'