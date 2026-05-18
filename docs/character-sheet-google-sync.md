## Character Sheet Google Sync

The character sheet now mirrors computed values to the Vercel Sheets sync endpoint on explicit `Save`.

### Trigger

- Sync runs after the character save succeeds.
- Inventory-only saves for non-owners also trigger sync, because equipped item changes can affect computed stats.
- Repeated saves with the exact same synced payload are skipped client-side to avoid unnecessary requests.

### Backend target

- Endpoint: `https://ulunavir-vercel.vercel.app/api/sync-character-sheet`
- Sheet id: `1I3OY-TlUcG4DMqDMGS-Vzim4EHtBgW-XTE16ta9lPbo`
- Tab name: `CptShape`

### Payload mapping

The frontend sends:

- `characterId`: the internal character id
- `characterName`: the current character name
- `sheetId`: the default Google sheet id above
- `tabName`: `CptShape`
- `values`: computed numeric sheet values only

Included `values` keys:

- every main attribute id, for example `str`, `dex`, `wis`
- every main attribute modifier id, for example `str_mod`, `dex_mod`
- every secondary attribute id
- every skill id
- every other attribute id
- every bar current/max pair, for example `hp_current`, `hp_max`

This means the Google Sheet acts as a raw mirrored data table. Spreadsheet formulas should read from that tab using the character id row and the desired column header.

### Security note

The sync secret is embedded in the static frontend, so it is only a lightweight gate and is not truly secret. Real security still depends on the Vercel endpoint limiting origin/misuse appropriately.
