import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'DroneViz3D — Single-Pass Drone to 3D Model',
  description: 'AI-enabled system for generating georeferenced 3D models from a single drone video pass.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
