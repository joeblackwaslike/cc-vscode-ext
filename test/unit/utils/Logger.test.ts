import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted() runs before vi.mock() is applied, making these available in the factory
const { createOutputChannel, mockChannel } = vi.hoisted(() => {
  const mockChannel = {
    appendLine: vi.fn(),
    append: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
    name: 'Claw Code',
  };
  return { createOutputChannel: vi.fn(() => mockChannel), mockChannel };
});

vi.mock('vscode', () => ({
  window: { createOutputChannel },
}));

import { Logger } from '../../../src/logging/Logger';

describe('Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an output channel with the given name', () => {
    const logger = new Logger('My Extension');
    expect(createOutputChannel).toHaveBeenCalledWith('My Extension');
    logger.dispose();
  });

  it('info() prefixes with [INFO]', () => {
    const logger = new Logger();
    logger.info('hello');
    expect(mockChannel.appendLine).toHaveBeenCalledWith('[INFO]  hello');
  });

  it('warn() prefixes with [WARN]', () => {
    const logger = new Logger();
    logger.warn('careful');
    expect(mockChannel.appendLine).toHaveBeenCalledWith('[WARN]  careful');
  });

  it('error() prefixes with [ERROR] and appends Error.message', () => {
    const logger = new Logger();
    logger.error('failed', new Error('oops'));
    expect(mockChannel.appendLine).toHaveBeenCalledWith('[ERROR] failed — oops');
  });

  it('error() with no error arg omits detail', () => {
    const logger = new Logger();
    logger.error('bad state');
    expect(mockChannel.appendLine).toHaveBeenCalledWith('[ERROR] bad state');
  });

  it('show() delegates to the output channel', () => {
    const logger = new Logger();
    logger.show();
    expect(mockChannel.show).toHaveBeenCalled();
  });

  it('dispose() delegates to the output channel', () => {
    const logger = new Logger();
    logger.dispose();
    expect(mockChannel.dispose).toHaveBeenCalled();
  });
});
