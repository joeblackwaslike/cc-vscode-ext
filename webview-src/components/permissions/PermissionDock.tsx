import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { PermissionDecision, PermissionRequest } from '../../lib/ipc';
import { postMessage } from '../../lib/ipc';
import { ASK_DECLINE_MESSAGE, buildExitPlanDecision, formatPlanFeedback } from '../../lib/permissions';
import { useChannelPermissions } from '../../store/sessionStore';
import { AskUserQuestionForm } from './AskUserQuestionForm';
import { DENY_MESSAGE, GenericPermission } from './GenericPermission';
import { PlanApproval } from './PlanApproval';

/** Shows the oldest pending permission prompt for a channel and posts the user's decision. */
export function PermissionDock({ channelId }: { channelId: string }) {
  const { permissions, dispatch } = useChannelPermissions(channelId);
  const dockRef = useRef<HTMLDivElement>(null);
  const pending = permissions.pending[0];
  if (!dispatch || !pending) return null;
  const request: PermissionRequest = pending;

  const comments = permissions.planComments[request.toolUseId ?? ''] ?? [];

  function decide(decision: PermissionDecision) {
    postMessage({ type: 'permission_response', channelId, requestId: request.requestId, decision });
  }

  function escapeDecision(): PermissionDecision {
    if (request.toolName === 'AskUserQuestion') return { behavior: 'deny', message: ASK_DECLINE_MESSAGE };
    if (request.toolName === 'ExitPlanMode') {
      const typed = dockRef.current?.querySelector<HTMLInputElement>('input[type=text]')?.value ?? '';
      return buildExitPlanDecision('keep-planning', request, formatPlanFeedback(comments, typed));
    }
    return { behavior: 'deny', message: DENY_MESSAGE };
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    decide(escapeDecision());
  }

  return (
    <div className="cc-permission-dock" data-testid="permission-dock" ref={dockRef} onKeyDown={onKeyDown}>
      {request.toolName === 'AskUserQuestion' ? (
        <AskUserQuestionForm key={request.requestId} request={request} onDecision={decide} />
      ) : request.toolName === 'ExitPlanMode' ? (
        <PlanApproval
          key={request.requestId}
          request={request}
          comments={comments}
          onRemoveComment={(commentId) =>
            request.toolUseId &&
            dispatch({ type: 'COMMENT_REMOVED', channelId, toolUseId: request.toolUseId, commentId })
          }
          onDecision={decide}
        />
      ) : (
        <GenericPermission key={request.requestId} request={request} onDecision={decide} />
      )}
    </div>
  );
}
