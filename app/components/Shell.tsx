import { Link, useLocation } from "@remix-run/react";

export function Shell({
  user,
  children,
}: {
  user: { name: string };
  children: React.ReactNode;
}) {
  const loc = useLocation();
  const is = (p: string) =>
    loc.pathname === p || (p !== "/" && loc.pathname.startsWith(p)) ? "active" : "";
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="dot" />
          <span>
            Buying Desk <small>· SHOP SELECT NYC</small>
          </span>
        </Link>
        <nav className="nav">
          <Link className={is("/")} to="/">
            Dashboard
          </Link>
          <Link className={is("/buy")} to="/buy">
            New Purchase
          </Link>
          <Link className={is("/purchases")} to="/purchases">
            Purchases
          </Link>
        </nav>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 13 }}>
          {user.name}
        </span>
        <form method="post" action="/logout">
          <button className="btn ghost sm" type="submit">
            Sign out
          </button>
        </form>
      </header>
      {children}
    </div>
  );
}
