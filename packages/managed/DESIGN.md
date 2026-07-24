---
name: Akriven Managed Control Plane
description: A precise multi-page operating surface for deterministic AI tool-call governance.
colors:
  ink: '#11131a'
  ink-soft: '#3f433f'
  paper: '#f5f4ee'
  paper-deep: '#ebe9df'
  paper-white: '#fffefa'
  acid: '#ddfe52'
  mint: '#72e6b1'
  coral: '#ff6b5e'
  amber: '#8a5700'
typography:
  headline:
    fontFamily: 'Geist, Helvetica Neue, Arial, ui-sans-serif, system-ui, sans-serif'
    fontSize: '28px'
    fontWeight: 620
    lineHeight: 1.15
    letterSpacing: '-0.035em'
  body:
    fontFamily: 'Geist, Helvetica Neue, Arial, ui-sans-serif, system-ui, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'Geist Mono, SFMono-Regular, Consolas, ui-monospace, monospace'
    fontSize: '11px'
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: '0.04em'
rounded:
  control: '6px'
  panel: '12px'
  status: '999px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '16px'
  lg: '24px'
  xl: '32px'
components:
  button-primary:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.paper}'
    rounded: '{rounded.control}'
    padding: '10px 14px'
    height: '42px'
  input:
    backgroundColor: '{colors.paper-white}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '10px 12px'
    height: '42px'
  panel:
    backgroundColor: '{colors.paper-white}'
    textColor: '{colors.ink}'
    rounded: '{rounded.panel}'
    padding: '20px'
---

# Design System: Akriven Managed Control Plane

## Overview

**Creative North Star: "The Evidence Console"**

The control plane feels like the operational side of the established Akriven
identity: warm paper, precise ink, compact technical metadata, and rare
acid-lime state emphasis. It replaces the single scrolling workbench with
focused product pages inside one consistent shell.

Expression never obscures the task. Navigation, content density, and familiar
controls carry the interface; brand appears through material, typography,
rules, and exact state behavior.

**Key Characteristics:**

- Focused route-like pages instead of anchor scrolling.
- Collapsible navigation with persistent operator context.
- Edge-to-edge evidence lists inside restrained paper surfaces.
- Compact, explicit state labels and quiet technical metadata.

## Colors

Near-black ink and warm paper establish the working surface. Acid lime is rare
and functional; mint, amber, and coral communicate deterministic outcomes.

**The Rare Acid Rule.** Acid lime identifies current selection, primary action,
focus, or a protection state. It is never ambient decoration.

## Typography

One Geist-led sans family carries the product hierarchy. Monospace is reserved
for identifiers, methods, paths, measurements, and raw evidence.

**The Operator Scale Rule.** Product headings stay compact and fixed-size.
Display typography and fluid marketing scales do not enter the control plane.

## Layout

Desktop uses a persistent 248px sidebar that collapses to 72px and a flexible
content region capped for readable operations. Pages use a consistent header,
action area, and content grid. Below 900px the sidebar becomes a transform-based
drawer; tables scroll rather than compress.

## Elevation & Depth

The system is flat by default. One-pixel rules and tonal paper layers create
structure. Shadows appear only for floating mobile navigation, menus, or
deliberate press feedback.

**The Rules Before Shadows Rule.** If a border or tonal surface can explain the
hierarchy, do not add elevation.

## Shapes

Controls use restrained six-pixel corners. Self-contained panels use
twelve-pixel corners. Pills are reserved for statuses and enumerated state.

## Components

### Buttons

Primary actions use ink on paper with immediate 0.97 press-scale feedback.
Secondary actions remain paper-colored with an ink rule. Destructive controls
use coral only when the action is truly destructive.

### Cards / Containers

Panels separate workflows, not every piece of text. Tables and lists remain
edge-to-edge within their owning region; nested cards are prohibited.

### Inputs / Fields

Inputs use white paper, a one-pixel rule, and a high-contrast ink-plus-acid
focus ring. Error copy states the problem and recovery.

### Navigation

Navigation is grouped by operator job. The current route uses an ink surface
and a small acid marker. Collapse retains icons and accessible labels; mobile
uses an overlay drawer.

## Do's and Don'ts

### Do:

- **Do** reveal product depth through task-focused pages.
- **Do** keep frequent page changes immediate and sidebar motion under 220ms.
- **Do** retain explicit mutation confirmation and placeholder rejection.
- **Do** honor reduced motion and keyboard focus.

### Don't:

- **Don't** turn navigation into anchor links on one long page.
- **Don't** expose every raw evidence block at the same time.
- **Don't** persist API keys in local storage or browser storage.
- **Don't** use decorative charts, gradients, glass, or motion.
