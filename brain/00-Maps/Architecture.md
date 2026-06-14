---
type: architecture
title: Architecture
updated: 2026-06-14
tags: [moc, architecture]
---

# 🏛️ Architecture

> [!abstract] Two versions coexist
> 1. **Original** ([[Original index.html]]) — single ~4100-line HTML file, zero
>    dependencies, runs from `file://`. Legacy reference.
> 2. **React rewrite** ([[React App]]) — Vite + React 18 + Framer Motion, modular
>    components. The port is complete and has grown past the original: **20 tools
>    across 4 categories** (see [[Tools]]).

## Core notes

- [[React App]] — project structure, dev server, deployment
- [[Runner Registry Pattern]] — how tools plug into the shell with zero coupling
- [[Repo Browser]] — GitHub/GitLab provider auto-detect, auth, cross-repo search
- [[Gotchas]] — hard-won pitfalls (WASM, alpha, blob URLs, ArrayBuffer detachment)
- [[Original index.html]] — legacy monolith reference

## The three orthogonal layers (Scene Studio model)

Scene Studio — the most complex tool — is built on three independent layers; the
same separation-of-concerns thinking applies across the toolkit:

1. **Composition** — what's on screen (layers, transforms).
2. **Animation** — keyframe channels with cubic-bezier / Hermite curves.
3. **Flow** — sequencing (wait/signal/emit), timeline.

See [[Scene Studio Design]] §3 for the full treatment.

## Tool wiring

Every tool registers an imperative `run` function on mount via the
[[Runner Registry Pattern]]. The shell (`App.jsx` → `ToolPanel.jsx`) never imports
a tool directly — `registry.js` is the only coupling point. See [[Tools]] for the
live inventory.
