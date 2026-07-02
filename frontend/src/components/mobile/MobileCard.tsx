export function MobileCard({
  children,
  className = '',
  noPadding = false,
}: {
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-hairline/12 bg-panel ${
        noPadding ? '' : 'p-4'
      } ${className}`}
    >
      {children}
    </div>
  );
}
