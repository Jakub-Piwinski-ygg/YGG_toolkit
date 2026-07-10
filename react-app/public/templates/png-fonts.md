---
name: PNG Fonts Template
description: Photoshop template for building PNG font atlases — used by the engine for win numbers, free-spin counters, multiplier counters and similar in-game text.
sharepoint: https://yggdrasilmlt.sharepoint.com/sites/gameassets/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Fgameassets%2FShared%20Documents%2F%5FTEMPLATES%2FStatic%20Art%2FFONT%5FTEMPLATES&viewid=698da493%2Def5f%2D4427%2D8f8e%2Dccc998cacd56
preview: FontTemplate/Font Template Thumbnail.png
updated: 2026-05-25
---

# PNG Fonts Template

PNG fonts are pre-rendered character atlases the engine assembles into runtime text. We use them anywhere text needs full art treatment — **win numbers** (the amount a player wins from a spin), **free-spin counters**, **multiplier counters**, and similar UI numbers.

## Which template to pick

Both files live in the same SharePoint folder (link at the bottom). They work identically — pick the one whose character set matches the use case:

- **Full template** — every digit, every currency symbol, and the full Latin alphabet as a fallback for unsupported currencies. Use this for **win numbers**.
- **Simple template** *WORK IN PROGRES* — digits and a handful of extras (`+`, `×`, etc). Use this for **FS counters**, **multiplier counters**, and other places that never show letters.

## Exporting

Export the **full sprite sheet as a PNG, exactly as it sits in Photoshop**. Don't slice or trim — Tech Art handles cutting it up inside Unity.

---

# Step-by-step

## Stage 1 — Open the preview layer comp and pick the font

![Stage 1 — open preview comp and select font](FontTemplate/font%20template%20stage%201.png)

1. Open the **Layer Comps** panel.
2. (`Window → Layer Comps` if it isn't visible.)
3. Activate the layer comp that shows the **Win Number preview text** so you have a live example to style.
4. Expand the **example Win Number** folder in the Layers panel.
5. Click the **Win Number** text layer. Important: this is only the **top main text layer**, not the outline layer underneath.
6. Open **Character settings** and click the font dropdown.

## Stage 2 — Pick your font

![Stage 2 — choose font and copy its name](FontTemplate/font%20template%20stage%202.png)

7. Select the font you want. Once it's applied, **copy the font name** — you'll paste it onto the outline layer next.

## Stage 3 — Apply the same font to the outline

![Stage 3 — paste font onto outline layer](FontTemplate/font%20template%20stage%203.png)

8. Select the **outline text layer**.
9. Paste the font name so the outline matches the main text.

## Stage 4 — Skip the outline, then style the font

![Stage 4 — disable outline and tweak effects](FontTemplate/font%20template%20stage%204.png)

10. If you don't want an outlined font, just **disable the outline layer** instead of styling it - i will make it that way in this tutorial.
11. **Double-click the layer effects** on the main text to open the effects dialog.
12. Tweak the effects until the font looks the way you want. If you're keeping the outline, repeat the same on the outline layer.

> At the end of this stage the preview text should be in its final look.

## Stage 5 — Copy the finished layer style

![Stage 5 — copy layer style](FontTemplate/font%20template%20stage%205.png)

13. Right-click the styled text layer.
14. Choose **Copy Layer Style**.

## Stage 6 — Switch to the atlas and paste onto every glyph

![Stage 6 — paste layer style onto all characters](FontTemplate/font%20template%20stage%206.png)

15. Back in the **Layer Comps** panel, switch to the comp that displays the **font atlas** (the grid of characters).
16. Select every character layer you want to style and right-click.
17. Choose **Paste Layer Style** — the look from the preview is applied to all selected glyphs at once.

## Stage 7 — Apply the font itself to every glyph

![Stage 7 — paste the font onto all characters](FontTemplate/font%20template%20stage%207.png)

18. Select all the character layers (Shift-click to grab everything, then Ctrl-click to deselect the **Letters** folder as it makes it impossible to chose font or paste layer style). Set them to the same font you chose in the preview.

> Repeat on the outline layer too if you kept the outline.

> ⚠️ Some fonts are missing characters you'd expect — e.g. the one in this screenshot doesn't ship with the Ruble `₽` when its mandatory to have. Always sanity-check the atlas before exporting. But anyway you can try to replace just the missing ones with some other simmilar font if its just currency sign.

---

## You're done

The atlas is ready. Export the whole sheet as a PNG, drop it in your project's export folder, and hand it to Tech Art — they'll cut it up in Unity.

Grab the latest `.psd` files from SharePoint below.
