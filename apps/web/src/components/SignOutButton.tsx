/** Plain form post to the logout route handler: works without JavaScript and clears httpOnly cookies. */
export function SignOutButton({ label }: { label: string }) {
  return (
    <form method="post" action="/api/session/logout">
      <button type="submit" className="pui-btn pui-outline pui-muted">
        {label}
      </button>
    </form>
  );
}
