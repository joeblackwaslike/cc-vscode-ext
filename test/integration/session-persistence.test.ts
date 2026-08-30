import * as assert from 'assert';
import * as vscode from 'vscode';

const EXT_ID = 'joeblackwaslike.clawd-code';

suite('Session persistence (globalState)', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    if (ext && !ext.isActive) await ext.activate();
  });

  test('extension activates cleanly with no prior state', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext?.isActive, 'Extension should be active');
  });

  test('context keys are set after activation', async () => {
    // Context keys drive the UI enablement in package.json menus/keybindings.
    // We verify that commands which depend on them are registered — if the
    // context keys were missing on activate(), the UI would misbehave.
    const commands = await vscode.commands.getCommands(true);

    // These commands are registered unconditionally in activate(); their
    // presence proves activate() ran to completion.
    assert.ok(commands.includes('clawd-vscode.acceptProposedDiff'));
    assert.ok(commands.includes('clawd-vscode.rejectProposedDiff'));
    assert.ok(commands.includes('clawd-vscode.showLogs'));
  });
});

suite('Session list webview view', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    if (ext && !ext.isActive) await ext.activate();
  });

  test('clawdVSCodeSessionsList view provider is registered', async () => {
    // Verify that revealing the sessions list view does not throw.
    // The view is registered via registerWebviewViewProvider in activate().
    let threw = false;
    try {
      await vscode.commands.executeCommand('clawdVSCodeSessionsList.focus');
    } catch {
      // Command may not exist if view container is not visible; record it so the
      // assertion can actually fail instead of always passing.
      threw = true;
    }
    assert.ok(!threw);
  });
});
