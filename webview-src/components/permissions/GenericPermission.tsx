import { useEffect, useRef } from 'react';
import type { PermissionDecision, PermissionRequest } from '../../lib/ipc';
import { getToolRenderer } from '../../lib/toolRegistry';

export const DENY_MESSAGE = 'User denied permission';

interface Props {
  request: PermissionRequest;
  onDecision: (decision: PermissionDecision) => void;
}

/** Allow/Deny card for any tool without a dedicated permission UI. */
export function GenericPermission({ request, onDecision }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => { rootRef.current?.focus(); }, []);
  const arg = getToolRenderer(request.toolName).primaryArg(request.input);
  return (
    <div className="cc-permission-generic" ref={rootRef} tabIndex={-1}>
      <div className="cc-permission-title">{request.toolName}</div>
      {arg && <code className="cc-permission-arg">{arg}</code>}
      {request.description && <div className="cc-permission-description">{request.description}</div>}
      <div className="cc-permission-actions">
        <button type="button" onClick={() => onDecision({ behavior: 'allow', updatedInput: request.input })}>Allow once</button>
        <button type="button" onClick={() => onDecision({ behavior: 'deny', message: DENY_MESSAGE })}>Deny</button>
      </div>
    </div>
  );
}
