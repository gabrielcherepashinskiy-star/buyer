import { Link, useLocation } from "@remix-run/react";

export function Shell({
  user,
  children,
}: {
  user: { name: string };
  children: React.ReactNode;
}) {
  const loc = useLocation();
  const exact = (p: string) => (loc.pathname === p ? "active" : "");
  const prefix = (p: string) => (loc.pathname === p || loc.pathname.startsWith(p + "/") ? "active" : "");
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/admin" className="brand">
          <img src="/logo-mark.png" alt="SHOP SELECT NYC" style={{ height: 30, width: "auto", display: "block" }} />
          <span>
            Buying Desk <small>· SHOP SELECT NYC</small>
          </span>
        </Link>
        <nav className="nav">
          <Link className={exact("/admin")} to="/admin">
            Dashboard
          </Link>
          <Link className={prefix("/admin/buy")} to="/admin/buy">
            New Purchase
          </Link>
          <Link className={prefix("/admin/purchases")} to="/admin/purchases">
            Purchases
          </Link>
          <Link className={prefix("/admin/submissions")} to="/admin/submissions">
            Submissions
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
