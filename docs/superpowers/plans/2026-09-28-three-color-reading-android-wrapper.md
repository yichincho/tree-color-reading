# Three-Color Reading Android Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a manually downloadable Android debug APK from the existing Three-Color Reading HTML prototype and make Gemini follow the current Flash model through the `gemini-flash-latest` alias.

**Architecture:** Keep the existing browser UI and API client as the product surface. Add a minimal Android WebView shell whose assets are the same HTML and JavaScript, then build it in GitHub Actions because the current workspace has no Android SDK or Gradle installation.

**Tech Stack:** HTML/CSS/JavaScript, Node built-in test runner, Kotlin, Android Gradle Plugin 8.7.3, Gradle 8.9, Java 17, Android SDK 35, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-28-three-color-reading-android-wrapper-design.md`

## Global Constraints

- Preserve Step One 骨幹 and Step Two 三色脫水閱讀法.
- Gemini default model is exactly `gemini-flash-latest`; do not hard-code `gemini-3.1`.
- DeepSeek default remains `deepseek-flash` with image input.
- Never commit a real API key.
- APK is a debug test build, not a production-signed release.

## Review Focus

- Gemini request without an explicit model still resolves to the latest alias; test the exact URL model path.
- A Gemini image request retains `inline_data`; keep the existing multimodal test.
- WebView assets must include both the HTML prototype and `api-client.js`; test file existence and manifest activity.
- GitHub Actions must build the debug APK without requiring a local Android SDK; inspect workflow inputs and artifact path.
- APK must not contain an API key or user-uploaded image; scan source and build inputs.

### Task 1: Gemini Auto Alias

**Files:**
- Modify: `api-client.js`
- Modify: `test/api-client.test.js`
- Modify: `README.md`
- Modify: `API_CONFIG.md`

**Interfaces:**
- `PROVIDERS.gemini.model` becomes `gemini-flash-latest`.
- `buildProviderRequest({ provider: 'gemini', ... })` continues to return the same REST shape, with the alias encoded in the model URL.

- [ ] **Step 1: Write the failing test** asserting the Gemini provider default and request URL contain `gemini-flash-latest` and do not contain `gemini-3.1`.
- [ ] **Step 2: Run `npm test` and confirm the new assertion fails because the current default is `gemini-3.1-flash-lite`.
- [ ] **Step 3: Change the Gemini provider model to `gemini-flash-latest` and update documentation labels.
- [ ] **Step 4: Run `npm test && npm run check` and confirm all tests pass.

### Task 2: Android WebView Shell

**Files:**
- Create: `android/settings.gradle.kts`
- Create: `android/build.gradle.kts`
- Create: `android/gradle.properties`
- Create: `android/app/build.gradle.kts`
- Create: `android/app/proguard-rules.pro`
- Create: `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/java/tw/yc/threecolorreading/MainActivity.kt`
- Create: `android/app/src/main/res/values/strings.xml`
- Create: `android/app/src/main/res/values/colors.xml`
- Create: `android/app/src/main/res/values/themes.xml`
- Create: `android/app/src/main/assets/three_color_reading_ui_prototype.html`
- Create: `android/app/src/main/assets/api-client.js`
- Create: `test/android-project-structure.test.js`

**Interfaces:**
- Android launcher activity: `tw.yc.threecolorreading.MainActivity`.
- WebView asset entrypoint: `https://appassets.androidplatform.net/assets/three_color_reading_ui_prototype.html`.
- Android manifest permission: `android.permission.INTERNET`.

- [ ] **Step 1: Write the failing structure test** for the manifest, Kotlin activity, assets, package ID, and Internet permission.
- [ ] **Step 2: Run the structure test and confirm it fails because `android/` does not exist.
- [ ] **Step 3: Add the minimal Kotlin WebView shell and copy the current HTML/API client into assets.
- [ ] **Step 4: Run the structure test and `node --check api-client.js`; confirm the shell and copied assets are valid.

### Task 3: GitHub Actions APK Build

**Files:**
- Create: `.github/workflows/android-debug-apk.yml`
- Modify: `README.md`

**Interfaces:**
- Workflow trigger: push to `main` and manual `workflow_dispatch`.
- Artifact name: `three-color-reading-v0.2.1-debug-apk`.
- Artifact path: `android/app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 1: Add the workflow and exact build/artifact paths.
- [ ] **Step 2: Validate the workflow YAML structure and Android project files locally.
- [ ] **Step 3: Commit and push the project to GitHub.
- [ ] **Step 4: Poll the workflow run until it succeeds; inspect logs if it fails.

### Task 4: Download and Verify APK

**Files:**
- No product source changes; generated APK is an external test artifact.

- [ ] **Step 1: Download the successful GitHub Actions artifact ZIP.
- [ ] **Step 2: Extract and verify the APK is a valid ZIP/APK with the expected filename and package metadata where tooling permits.
- [ ] **Step 3: Run the full Node test suite again and provide the APK download link plus GitHub source/workflow links.
