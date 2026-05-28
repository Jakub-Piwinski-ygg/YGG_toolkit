---
name: Spine Export Settings
description: Default export and packer settings for Spine projects — load these once per .spine file so the JSON + atlas export matches the engine's expectations.
sharepoint: https://yggdrasilmlt.sharepoint.com/sites/gameassets/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Fgameassets%2FShared%20Documents%2F%5FTEMPLATES%2FSPINE%5FTEMPLATES%2FExport%20Settings&viewid=698da493%2Def5f%2D4427%2D8f8e%2Dccc998cacd56
preview: Spine/spine%20export%20stage%201.png
updated: 2026-05-28
---

# Spine Export Settings

Two settings files (`ExportSettings.export` and `PackerSettings.pack`) that configure the Spine JSON + atlas export to match what the engine and Tech Art expect.

> ⚠️ **Export settings are saved per `.spine` project.** When you close one project and open another, the new project may still be carrying its own (possibly wrong) export configuration. Walk through these steps again every time you switch projects to make sure the settings actually match.

## Before you start

Download both files from SharePoint (link at the bottom) and keep them somewhere safe and easy to browse to — you'll be pointing Spine at them every time you set up a new project.

The two files:

- **`ExportSettings.export`** — JSON export configuration.
- **`PackerSettings.pack`** — texture packer configuration.

---

# Step-by-step

First, in Spine, choose to export the current project in **JSON** format. That opens the Export dialog, where the steps below begin.

## Step 1 — Load

![Export dialog, Load button](Spine/spine%20export%20stage%201.png)

1. In the Export dialog, click **Load**.

## Step 2 — Browse

![Browse for export settings file](Spine/spine%20export%20stage%202.png)

2. Click **Browse** to pick the settings file from disk.

## Step 3 — Select the export settings file

![Select ExportSettings.export](Spine/spine%20export%20stage%203.png)

3. Select the **`ExportSettings.export`** file.
4. Click **Open**.

## Step 4 — Open Pack settings

![Pack settings button](Spine/spine%20export%20stage%204.png)

5. Open the **Pack settings** dialog.

## Step 5 — Load

![Pack settings, Load button](Spine/spine%20export%20stage%205.png)

6. In the Pack settings dialog, click **Load**.

## Step 6 — Browse

![Browse for pack settings file](Spine/spine%20export%20stage%206.png)

7. Click **Browse** to pick the packer settings file from disk.

## Step 7 — Select the packer settings file

![Select PackerSettings.pack](Spine/spine%20export%20stage%207.png)

8. Select the **`PackerSettings.pack`** file.
9. Click **Open**.

## Step 8 — Confirm

![OK on Pack settings](Spine/spine%20export%20stage%208.png)

10. Click **OK** to close the Pack settings dialog.

## Step 9 — Choose export location and finalize

![Pick output folder and export](Spine/spine%20export%20stage%209.png)

11. Pick the correct export location for your file.
12. Finalize the export.

---

## You're done

The project is exported with the standard settings. Remember to repeat these steps whenever you open a different `.spine` project — settings don't carry across files.

Grab the latest `.export` and `.pack` files from SharePoint below.
