# Color Palette Documentation

This document lists all colour variables defined in the site’s CSS (`src/assets/css/style.css`). The colours are stored as CSS custom properties (variables) and are used throughout the site for backgrounds, text, accents, borders, and layout.

| Variable | Hex / Value | Typical Use |
|----------|-------------|------------|
| `--color-bg-primary` | `#1a1a1a` | Main page background, landing container background |
| `--color-bg-secondary` | `#222222` | Secondary sections (e.g., research/code panels) |
| `--color-bg-elevated` | `#2a2a2a` | Elevated surfaces: navigation bar, footer, code blocks |
| `--color-text-primary` | `#A69C7D` | Primary body text, landing tagline |
| `--color-text-secondary` | `#8a8270` | Secondary text such as navigation links, footer text |
| `--color-text-heading` | `#c4b897` | Headings (`h1‑h4`) and the landing name |
| `--color-accent-primary` | `#4a6741` | Primary accent – links, active nav items |
| `--color-accent-hover` | `#5c8a50` | Accent on hover/focus |
| `--color-accent-dim` | `#2d3d28` | Dimmed accent – blockquote borders, subtle UI elements |
| `--color-border` | `#333333` | Borders for containers, navigation, footer |
| `--font-mono` | `'IBM Plex Mono', monospace` | Default monospaced font family |
| `--max-width` | `48rem` | Maximum width for content containers |

## Using the palette

Reference the variables in CSS with `var(--variable-name)`. Example snippets:

```css
body { background-color: var(--color-bg-primary); }
.landing-name { color: var(--color-text-heading); }
a { color: var(--color-accent-primary); }
a:hover { color: var(--color-accent-hover); }
```

Add new colour variables following the `--color-<category>-<modifier>` naming convention to keep the palette consistent.
