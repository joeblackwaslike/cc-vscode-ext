import * as assert from 'assert';
import * as vscode from 'vscode';

const EXT_ID = 'reference.claw-code';

// Expected command IDs from package.json contributes.commands
const EXPECTED_COMMANDS = [
  'claw-vscode.editor.open',
  'claw-vscode.editor.openLast',
  'claw-vscode.primaryEditor.open',
  'claw-vscode.sidebar.open',
  'claw-vscode.newConversation',
  'claw-vscode.reopenClosedSession',
  'claw-vscode.terminal.open',
  'claw-vscode.acceptProposedDiff',
  'claw-vscode.rejectProposedDiff',
  'claw-vscode.insertAtMention',
  'claw-vscode.showLogs',
  'claw-vscode.openWalkthrough',
];

// These collide with the real Anthropic.claude-code extension and must NOT be
// registered — re-registering them threw and crash-looped the extension host.
const FORBIDDEN_COMMANDS = [
  'claude-code.acceptProposedDiff',
  'claude-code.rejectProposedDiff',
  'claude-code.insertAtMentioned',
];

suite('Extension activation', () => {
  let ext: vscode.Extension<unknown>;

  suiteSetup(async () => {
    const found = vscode.extensions.getExtension(EXT_ID);
    assert.ok(found, `Extension "${EXT_ID}" not found — check publisher/name in package.json`);
    ext = found;
    if (!ext.isActive) {
      await ext.activate();
    }
  });

  test('extension is present in the extensions list', () => {
    assert.ok(vscode.extensions.getExtension(EXT_ID));
  });

  test('extension activates without error', () => {
    assert.ok(ext.isActive, 'Extension should be active after activate()');
  });

  test('extension package.json has expected metadata', () => {
    const { packageJSON } = ext;
    assert.strictEqual((packageJSON as Record<string, unknown>).name, 'claw-code');
    assert.strictEqual((packageJSON as Record<string, unknown>).publisher, 'reference');
  });
});

suite('Command registration', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    if (ext && !ext.isActive) await ext.activate();
  });

  test('all expected commands are registered', async () => {
    const registered = await vscode.commands.getCommands(true);
    const missing = EXPECTED_COMMANDS.filter((cmd) => !registered.includes(cmd));
    assert.deepStrictEqual(
      missing,
      [],
      `Missing commands: ${missing.join(', ')}`,
    );
  });

  test('does not contribute commands that collide with Anthropic.claude-code', () => {
    // The real extension may not be installed in the test host, so assert on our
    // OWN manifest: we must never be the one to contribute these IDs (registering
    // them threw `command '...' already exists` and crash-looped the host).
    const ours: Array<{ command: string }> =
      vscode.extensions.getExtension(EXT_ID)?.packageJSON?.contributes?.commands ?? [];
    const oursColliding = ours
      .map((c) => c.command)
      .filter((id) => FORBIDDEN_COMMANDS.includes(id));
    assert.deepStrictEqual(
      oursColliding,
      [],
      `claw-code contributes colliding command IDs: ${oursColliding.join(', ')}`,
    );
  });
});
