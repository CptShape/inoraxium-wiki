# Skill Tree Tool

The Inoraxium `Tools > Skill Tree` page can import exported `.json` files from [RPG Skill Tree Generator](https://www.rpgskilltreegenerator.com) and save named copies into Firestore.

## What the page does

- loads a bundled sample tree by default
- imports exported JSON files directly from your computer
- lets you allocate points on the imported tree
- saves the full tree state, including current point allocation, into Firestore
- lets you switch between saved trees from a dropdown
- supports `Save` and `Save as Copy`

## Firestore collection

Saved trees are stored in the `skillTrees` collection.

Each document contains:

```json
{
  "name": "Modular Polymorph",
  "system": "inoraxium",
  "source": "rpgskilltreegenerator",
  "treeData": { "...": "full imported JSON payload with updated points" },
  "createdAt": "2026-05-16T12:34:56.000Z",
  "updatedAt": "2026-05-16T12:34:56.000Z",
  "createdBy": "firebase-user-id-or-null",
  "createdByName": "Display Name",
  "updatedBy": "firebase-user-id-or-null",
  "updatedByName": "Display Name"
}
```

The Firestore document id is also used as the internal saved-tree id in the UI.

## Permissions

- anyone can open the page and view/import trees locally in the browser session
- saving to Firestore is only enabled for signed-in users who pass the existing `loadEditorAccess(...)` permission check

That means the same editor permission model already used elsewhere in the project applies here too.

## Saving behavior

`Save`

- updates the currently selected saved tree if one is selected
- creates a new saved tree if nothing is selected yet

`Save as Copy`

- always creates a brand new Firestore document
- leaves the previously selected saved tree untouched

## Switching between trees

The dropdown loads:

- the bundled sample tree
- all saved trees in Firestore for the selected game system

Right now this tool is registered only under the Inoraxium system, so its saves use:

```text
system = "inoraxium"
```

## Notes

- imported JSON images still depend on the original RPG Skill Tree Generator asset paths being reachable
- the tool preserves and re-saves the imported JSON payload rather than converting it to a new schema
- this makes it much easier to round-trip imported trees and keep compatibility with the original exporter
