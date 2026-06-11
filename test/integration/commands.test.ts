import * as assert from 'assert';
import * as vscode from 'vscode';

const EXT_ID = 'reference.claude-code-reference';

suite('claw-vscode.editor.open', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    if (ext && !ext.isActive) await ext.activate();
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('executes without throwing', async () => {
    let threw = false;
    try {
      await vscode.commands.executeCommand('claw-vscode.editor.open');
    } catch {
      threw = true;
    }
    assert.ok(!threw, 'claw-vscode.editor.open should not throw');
  });
});

suite('claw-vscode.terminal.open', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    if (ext && !ext.isActive) await ext.activate();
  });

  teardown(() => {
    for (const terminal of vscode.window.terminals) {
      terminal.dispose();
    }
  });

  test('creates a new terminal', async () => {
    const before = vscode.window.terminals.length;
    await vscode.commands.executeCommand('claw-vscode.terminal.open');
    assert.ok(
      vscode.window.terminals.length > before,
      'Expected at least one new terminal after command',
    );
  });

  test('new terminal is named "Claw Code"', async () => {
    await vscode.commands.executeCommand('claw-vscode.terminal.open');
    const claude = vscode.window.terminals.find((t) => t.name === 'Claw Code');
    assert.ok(claude, 'Expected a terminal named "Claw Code"');
  });
});

suite('claw-vscode.showLogs', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    if (ext && !ext.isActive) await ext.activate();
  });

  test('executes without throwing', async () => {
    let threw = false;
    try {
      await vscode.commands.executeCommand('claw-vscode.showLogs');
    } catch {
      threw = true;
    }
    assert.ok(!threw, 'showLogs should not throw');
  });
});

suite('claw-vscode.acceptProposedDiff / rejectProposedDiff', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    if (ext && !ext.isActive) await ext.activate();
  });

  test('acceptProposedDiff executes without throwing when no diff is open', async () => {
    let threw = false;
    try {
      await vscode.commands.executeCommand('claw-vscode.acceptProposedDiff');
    } catch {
      threw = true;
    }
    assert.ok(!threw);
  });

  test('rejectProposedDiff executes without throwing when no diff is open', async () => {
    let threw = false;
    try {
      await vscode.commands.executeCommand('claw-vscode.rejectProposedDiff');
    } catch {
      threw = true;
    }
    assert.ok(!threw);
  });
});
