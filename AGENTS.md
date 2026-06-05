# z7Note Agent Rules

- After changing project code, assets, or configuration, rebuild the Docker image before handing work back. Prefer `docker compose build`; use `docker-compose build` only when the Compose plugin is unavailable. After rebuilding, verify through the Docker/Compose service that will actually run the app.
- Do not start a separate standalone z7Note server for verification. It can risk touching the wrong database. Use the existing Docker Compose service and its configured volumes only.
- Do not overwrite unrelated local changes. Check the working tree and keep edits scoped to the user request.
- For iPhone or mobile editor work, verify the editor in a narrow mobile viewport when feasible, including focus, typing, and scroll behavior.
- Version release rules:
  - Treat `package.json` as the local application version source. When publishing a new release, bump it to the new semantic version first, such as `1.0.6`.
  - Publish Docker images with both a semantic version tag and `latest`, for example `hzx2185/z7note:1.0.6` and `hzx2185/z7note:latest`.
  - Each published Docker tag should be a multi-architecture manifest that includes `linux/amd64` and `linux/arm64`. Do not split normal releases into separate amd/arm tags unless explicitly requested.
  - The admin version checker can compare semantic tags, but it cannot prove freshness from `latest` alone. If only `latest` exists, show it as a tag that needs confirmation instead of treating it as a newer version.
  - Admin "auto update" is only a trigger for the real container update flow; it does not replace Docker/Compose updates. The fixed update command should still run the equivalent of `docker compose pull && docker compose up -d`, or `git pull && docker compose build && docker compose up -d` for source builds.
  - Never accept an arbitrary update command from the browser. Only execute a fixed server-side command such as `Z7NOTE_UPDATE_COMMAND`, and only when the deployment has intentionally granted access to the host update mechanism.
- Development and release workflow rules:
  - Cache Control: Whenever modifying frontend static assets (scripts under `public/js/` or stylesheets under `public/css/`), always bump the cache-busting query parameter (`?v=...`) in all referencing HTML (e.g., `calendar.html`, `app.html`) and CSS files (e.g., `app.css`, `page-app.css`) to prevent browsers from loading stale cached code.
  - Quality Assurance: Before committing code, building Docker images, or pushing releases, always run `npm test` locally and ensure that all unit tests pass successfully.
  - Database Migrations: Do not perform direct SQLite schema modifications. Always create a new migration script under `src/migrations/`, verify its execution at startup, and ensure the new migration script is tracked, staged, and committed.
  - Changelog Synchronization: Before pushing a new version to GitHub and Docker Hub, ensure the local version in `package.json` is bumped, the `CHANGELOG_ENTRIES` array in `public/js/changelog-data.js` has a corresponding release entry matching the version and release date, and cache-busters are updated.
  - Multi-platform Docker Builds: When compiling multi-architecture manifests (amd64 and arm64), explicitly specify a Buildx builder using the `docker-container` driver (such as `--builder mybuilder`) to avoid build failures associated with default host platform drivers.

