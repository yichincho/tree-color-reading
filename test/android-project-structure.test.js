const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('Android wrapper has the launcher, network permission, and bundled web assets', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const appGradle = read('android/app/build.gradle.kts');
  const activity = read('android/app/src/main/java/tw/yc/threecolorreading/MainActivity.kt');
  const workflow = read('.github/workflows/android-debug-apk.yml');
  const bundledApiClient = read('android/app/src/main/assets/api-client.js');
  const iconManifestPath = path.join(root, 'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml');
  const roundIconManifestPath = path.join(root, 'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml');
  const iconForegroundPath = path.join(root, 'android/app/src/main/res/drawable/ic_launcher_foreground.xml');

  assert.match(manifest, /android\.permission\.INTERNET/);
  assert.match(manifest, /android:name="\.MainActivity"/);
  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher_round"/);
  assert.match(appGradle, /applicationId = "tw\.yc\.threecolorreading"/);
  assert.match(activity, /loadUrl\("https:\/\/appassets\.androidplatform\.net\/assets\/three_color_reading_ui_prototype\.html"\)/);
  assert.match(bundledApiClient, /gemini-flash-latest/);
  assert.doesNotMatch(bundledApiClient, /gemini-3\.1-flash-lite/);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /three-color-reading-v0\.2\.2-debug-apk/);
  assert.match(workflow, /app\/build\/outputs\/apk\/debug\/app-debug\.apk/);
  assert.equal(fs.existsSync(path.join(root, 'android/app/src/main/assets/three_color_reading_ui_prototype.html')), true);
  assert.equal(fs.existsSync(path.join(root, 'android/app/src/main/assets/api-client.js')), true);
  assert.equal(fs.existsSync(iconManifestPath), true);
  assert.equal(fs.existsSync(roundIconManifestPath), true);
  assert.equal(fs.existsSync(iconForegroundPath), true);

  const icon = read('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml');
  const roundIcon = read('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml');
  const foreground = read('android/app/src/main/res/drawable/ic_launcher_foreground.xml');
  assert.match(icon, /adaptive-icon/);
  assert.match(roundIcon, /adaptive-icon/);
  assert.match(foreground, /#111827/);
  assert.match(foreground, /#2563EB/);
  assert.match(foreground, /#EF4444/);
  assert.doesNotMatch(foreground, /robot/i);
});
