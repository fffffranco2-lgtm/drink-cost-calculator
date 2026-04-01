import { AdminNavBar } from "./components/AdminNavBar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminNavBar />
      {children}
    </>
  );
}
