# Google Login And Admin Character Transfer

This project now uses Google popup login as the primary sign-in flow. New Google users are automatically registered in Firestore under `users/{uid}` after their first successful login.

## Firebase Setup

1. Open Firebase Console.
2. Go to Authentication > Sign-in method.
3. Enable Google.
4. Add the local/deployed domains you use under Authentication > Settings > Authorized domains.
5. Ask every player to sign in once with their new Google account so their `users/{uid}` profile exists.

## Granting Admin Access

Use one of these options:

- Add `VITE_ADMIN_EMAILS=your-developer@gmail.com` to `.env` for local UI access.
- Add `VITE_ADMIN_UIDS=firebase_uid_here` to `.env` for local UI access.
- Recommended production source: create a Firestore document at `adminUsers/{uid}` with `{ "admin": true }`.

The frontend reads admin access from `adminUsers/{uid}`, `userPermissions/{uid}`, or `users/{uid}` if those documents contain an admin role/permission.

## Character Transfer Flow

1. Sign in with the admin Google account.
2. Open Tools > Characters.
3. Admin can see all characters.
4. Select an old character.
5. In Quick Editor, use Admin Owner Transfer.
6. Choose the new Google user or paste their Firebase UID manually.
7. Click Change Owner.

This updates the character document:

```json
{
  "userId": "new_google_uid",
  "ownerEmail": "player@gmail.com",
  "ownerTransferredAt": 1787330000000
}
```

## Security Rule Reminder

Client-side admin UI is not real security by itself. Firestore rules must also allow admins to read all characters and update `userId`.

Use this as the intended shape, then adapt it to your current rules:

```txt
function isAdmin() {
  return request.auth != null
    && exists(/databases/$(database)/documents/adminUsers/$(request.auth.uid));
}

match /characters/{characterId} {
  allow read: if isAdmin()
    || resource.data.userId == request.auth.uid
    || resource.data.visibility == "public";

  allow create: if request.auth != null
    && request.resource.data.userId == request.auth.uid;

  allow update, delete: if isAdmin()
    || resource.data.userId == request.auth.uid;
}

match /users/{userId} {
  allow read: if isAdmin() || request.auth.uid == userId;
  allow write: if request.auth.uid == userId;
}
```

If the rules are not updated, the admin UI may appear but Firestore can still reject all-character reads or owner transfers.
