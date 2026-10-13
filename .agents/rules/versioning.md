# Automatic Version Update Rule

Whenever any modification, bug fix, feature addition, or update is made to this codebase:
1. Immediately bump the version in:
   - `package.json`
   - `package-lock.json`
   - `src/renderer/index.html` (the version badge)
2. Use Semantic Versioning:
   - Patch bump (`1.2.0` -> `1.2.1`) for fixes, tweaks, CSS/layout corrections.
   - Minor bump (`1.2.0` -> `1.3.0`) for new sections, features, and functional modules.
3. Ensure releases and installer builds reflect this version consistently.
