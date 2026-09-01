# GitHub Pages Deploy

This project now deploys directly from this repository with GitHub Actions.

## One-Time GitHub Setup

1. Open the GitHub repository settings.
2. Go to `Settings > Pages`.
3. Set `Build and deployment > Source` to `GitHub Actions`.
4. Go to `Settings > Secrets and variables > Actions`.
5. Add these repository secrets with the same values from your local `.env` file:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`

## Normal Deploy Flow

1. Make code/content changes in this project.
2. Run `npm run build` locally if you want to test the production build.
3. Commit and push to `main`.
4. GitHub Actions will run `.github/workflows/deploy-pages.yml`.
5. The workflow builds the site and deploys the generated `dist` folder to GitHub Pages.

You no longer need to copy `dist` into a separate GitHub Pages project.

## Important Notes

- This is still a static GitHub Pages site. React, Firebase, and Vercel API calls run in the browser.
- The Vite `base` path is set to `/inoraxium-wiki/`, matching the repository name.
- If the repository name or Pages URL changes, update `base` in `vite.config.ts`.
