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
  'claw-vscode.toggleFocusView',
];

// The original Anthropic.claude-code command IDs. Claw Code is a drop-in
// replacement, so it aliases these at RUNTIME when the real extension is absent
// (it is, in this clean test host) — but must never *contribute* them statically
// in package.json, which is what collided and crash-looped the host. Covers the
// primary claude-vscode.* namespace (1:1 mirror of claw-vscode.*) plus the older
// claude-code.* IDs the real extension still carries.
const MIRRORED_SUFFIXES = [
  'editor.open',
  'editor.openLast',
  'primaryEditor.open',
  'window.open',
  'createWorktree',
  'sidebar.open',
  'newConversation',
  'reopenClosedSession',
  'update',
  'focus',
  'blur',
  'logout',
  'terminal.open',
  'terminal.open.keyboard',
  'acceptProposedDiff',
  'rejectProposedDiff',
  'insertAtMention',
  'installPlugin',
  'showLogs',
  'openWalkthrough',
];
const COMPAT_ALIAS_COMMANDS = [
  ...MIRRORED_SUFFIXES.map((s) => `claude-vscode.${s}`),
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

  test('does not statically contribute claude-code.* commands (the collision)', () => {
    // The crash came from a STATIC package.json contribution that re-registered
    // the real extension's IDs. Those IDs must never appear in our manifest.
    const ours: Array<{ command: string }> =
      vscode.extensions.getExtension(EXT_ID)?.packageJSON?.contributes?.commands ?? [];
    const oursColliding = ours
      .map((c) => c.command)
      .filter((id) => COMPAT_ALIAS_COMMANDS.includes(id));
    assert.deepStrictEqual(
      oursColliding,
      [],
      `claw-code statically contributes colliding command IDs: ${oursColliding.join(', ')}`,
    );
  });

  test('registers claude-code.* compat aliases at runtime (real extension absent in test host)', async () => {
    // The clean test host has no Anthropic.claude-code, so drop-in compatibility
    // means our runtime aliases should be present and invokable by ID.
    assert.ok(
      !vscode.extensions.getExtension('anthropic.claude-code'),
      'precondition: the real extension must be absent in the test host',
    );
    const registered = await vscode.commands.getCommands(true);
    const missing = COMPAT_ALIAS_COMMANDS.filter((cmd) => !registered.includes(cmd));
    assert.deepStrictEqual(missing, [], `Missing compat aliases: ${missing.join(', ')}`);
  });
});
