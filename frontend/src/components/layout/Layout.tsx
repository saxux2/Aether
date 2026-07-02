import { Header } from './Header';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-page text-fg flex flex-col antialiased">
      <Header />
      <main className="flex-1 overflow-y-auto p-3 sm:p-6">{children}</main>
    </div>
  );
}
