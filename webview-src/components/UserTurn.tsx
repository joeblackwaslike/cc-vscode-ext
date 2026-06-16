/** A user message turn — right-aligned bubble. */
export function UserTurn({ text }: { text: string }) {
  return (
    <div className="cc-user" data-testid="chat-message-user">
      <div className="cc-user__bubble">{text}</div>
    </div>
  );
}
