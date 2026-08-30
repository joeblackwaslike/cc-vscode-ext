import * as assert from 'assert';
import * as vscode from 'vscode';

const EXT_ID = 'joeblackwaslike.clawd-code';

suite('clawd-vscode.editor.open', () => {
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
      await vscode.commands.executeCommand('clawd-vscode.editor.open');
    } catch {
      threw = true;
    }
    assert.ok(!threw, 'clawd-vscode.editor.open should not throw');
  });
});

suite('clawd-vscode.terminal.open', () => {
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
    await vscode.commands.executeCommand('clawd-vscode.terminal.open');
    assert.ok(
      vscode.window.terminals.length > before,
      'Expected at least one new terminal after command',
    );
  });

  test('new terminal is named "Clawd Code"', async () => {
    await vscode.commands.executeCommand('clawd-vscode.terminal.open');
    const claude = vscode.window.terminals.find((t) => t.name === 'Clawd Code');
    assert.ok(claude, 'Expected a terminal named "Clawd Code"');
  });
});

suite('clawd-vscode.showLogs', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    if (ext && !ext.isActive) await ext.activate();
  });

  test('executes without throwing', async () => {
    let threw = false;
    try {
      await vscode.commands.executeCommand('clawd-vscode.showLogs');
    } catch {
      threw = true;
    }
    assert.ok(!threw, 'showLogs should not throw');
  });
});

suite('clawd-vscode.acceptProposedDiff / rejectProposedDiff', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    if (ext && !ext.isActive) await ext.activate();
  });

  test('acceptProposedDiff executes without throwing when no diff is open', async () => {
    let threw = false;
    try {
      await vscode.commands.executeCommand('clawd-vscode.acceptProposedDiff');
    } catch {
      threw = true;
    }
    assert.ok(!threw);
  });

  test('rejectProposedDiff executes without throwing when no diff is open', async () => {
    let threw = false;
    try {
      await vscode.commands.executeCommand('clawd-vscode.rejectProposedDiff');
    } catch {
      threw = true;
    }
    assert.ok(!threw);
  });
});
