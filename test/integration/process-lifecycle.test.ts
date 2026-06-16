import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const EXT_ID = 'reference.claw-code';

function getExtensionPath(): string {
  const ext = vscode.extensions.getExtension(EXT_ID);
  assert.ok(ext, `Extension "${EXT_ID}" not found`);
  return ext.extensionPath;
}

// The claude binary is no longer bundled in the repo — it's downloaded on first
// run into the extension's global storage (see src/process/ClaudeBinary.ts), so
// there is nothing to assert at a fixed `resources/native-binary` path here.
// Binary resolution/download is covered by test/unit/process/ClaudeBinary.test.ts.

suite('Extension dist bundle', () => {
  test('dist/extension.js exists (extension was built)', () => {
    const distPath = path.join(getExtensionPath(), 'dist', 'extension.js');
    assert.ok(
      fs.existsSync(distPath),
      `dist/extension.js not found at ${distPath} — run npm run build first`,
    );
  });
});
