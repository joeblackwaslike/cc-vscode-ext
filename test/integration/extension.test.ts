import * as assert from 'assert';
import * as vscode from 'vscode';

const EXT_ID = 'reference.claude-code-reference';

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
  'claude-code.acceptProposedDiff',
  'claude-code.rejectProposedDiff',
  'claude-code.insertAtMentioned',
  'claw-vscode.showLogs',
  'claw-vscode.openWalkthrough',
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
    assert.strictEqual((packageJSON as Record<string, unknown>).name, 'claude-code-reference');
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
});
