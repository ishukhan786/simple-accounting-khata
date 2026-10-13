# Workspace Rules & Guidelines - Simple Accounting Khata

## 1. Version Update on Changes (MANDATORY)
Jab bhi application mein koi bhi update, bug fix, layout change, ya naya feature add kiya jaye:
- **Version Bump Lazmi Karein**:
  - `package.json` mein `"version"` update karein.
  - `package-lock.json` mein `"version"` synchronize karein.
  - `src/renderer/index.html` mein version badge / text (e.g., `#app-version-badge`) ko naye version ke sath update karein.
- **Versioning Strategy**:
  - **Patch update (e.g., 1.2.0 -> 1.2.1)**: Minor bug fixes, UI/CSS adjustments, scroll fixes, layout refinements.
  - **Minor update (e.g., 1.2.0 -> 1.3.0)**: New features (jaise Roznamcha, naye reports, export features, etc.).
- **Installer Build Consistency**:
  - Jab bhi new build banayi jaye (`node stage-release.js && npx electron-builder --win`), verify karein ke `dist/` mein generate hone wala installer aur `latest.yml` naye version ko accurately reflect karein.

## 2. Statement Empty Amount Cell Rule
- Customer Statement / Khata ke Debit aur Credit columns mein agar kisi row par amount na ho ya 0 ho, to cell khali (`""`) rahega (dash `—` ya `0.00` nahi likhna). Yeh preview, print aur PDF teeno mein barkarar rakhna hai.

## 3. Tool & Execution Standards
- Windows PowerShell mein direct npm/npx execution policy restrictions se bachne ke liye build aur CLI commands ko hamesha `cmd /c "..."` ke zariye run karein.
