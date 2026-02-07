import Link from "next/link";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface-0 px-4 py-5">
        <Link
          href="/overview"
          className="mb-8 text-lg font-bold tracking-tight text-foreground"
        >
          Temper
        </Link>

        <nav className="flex flex-col gap-0.5 text-sm">
          <SidebarLink href="/overview">Overview</SidebarLink>
          <SidebarLink href="/upload">Upload</SidebarLink>
        </nav>

        <div className="mt-auto pt-4 text-[11px] text-muted-foreground">
          v0.1.0
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-8 py-6">
        {children}
      </main>
    </div>
  );
}

function SidebarLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
    >
      {children}
    </Link>
  );
}
