import { Outlet } from 'react-router-dom';

/** Content only — report sections are navigated from the sidebar under “Reports”. */
export function ReportsLayout() {
  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <Outlet />
    </div>
  );
}
