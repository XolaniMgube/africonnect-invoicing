"use client";
import { useState } from "react";
import { useData } from "@/components/provider";
import { BusinessMark, Empty, PageHeading } from "@/components/ui";
import type { Role } from "@/domain/types";

/** Admin only: roles, super businesses and who can see each one. */
export function Admin() {
  const {
    db,
    employee,
    backend,
    setEmployeeRole,
    setBusinessSuper,
    setBusinessAccess,
  } = useData();
  const [busy, setBusy] = useState("");
  if (!db || !employee) return null;
  if (employee.role !== "admin")
    return (
      <Empty
        title="Admins only"
        description="Ask an admin if you need a role or access changed."
      />
    );
  const staff = db.employees.filter((e) => e.role === "staff");
  const businesses = [...db.businesses].sort(
    (a, b) =>
      Number(b.isSuper) - Number(a.isSuper) || a.name.localeCompare(b.name),
  );
  // One change at a time, so quick clicks can't overtake each other.
  async function change(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    await action();
    setBusy("");
  }

  return (
    <>
      <PageHeading
        eyebrow="ADMIN"
        title="Users & access"
        description="Choose who is an admin, which businesses are super businesses, and which staff can see each super business."
      />
      <div className="admin-grid">
        <section className="card admin-card">
          <h2>Users</h2>
          <p className="muted">
            Admins manage users and super businesses and see every business.
            Staff see ordinary businesses, plus super businesses they’re given.
          </p>
          <ul className="admin-list">
            {db.employees.map((e) => (
              <li key={e.id}>
                <span className="avatar">
                  {(e.name || e.email).slice(0, 2).toUpperCase()}
                </span>
                <span className="admin-person">
                  <strong>
                    {e.name || e.email}
                    {e.id === employee.id && " (you)"}
                  </strong>
                  <small>{e.email}</small>
                </span>
                <select
                  aria-label={`Role for ${e.name || e.email}`}
                  value={e.role}
                  disabled={!!busy}
                  onChange={(event) =>
                    void change(e.id, () =>
                      setEmployeeRole(
                        e.id,
                        event.target.value as Role,
                        `${e.name || e.email} is now ${event.target.value === "admin" ? "an admin" : "staff"}.`,
                      ),
                    )
                  }
                >
                  <option value="admin">Admin</option>
                  <option value="staff">Staff</option>
                </select>
              </li>
            ))}
          </ul>
          <p className="admin-hint">
            {backend === "supabase"
              ? "To add someone, create their login in Supabase (Authentication → Users) and add them to public.employees (see the README). They start as staff."
              : "Demo users are fictional; the demo sign-in is an admin."}
          </p>
        </section>
        <section className="card admin-card">
          <h2>Super businesses</h2>
          <p className="muted">
            Super businesses get payments and reminders as they’re added, and
            are hidden from staff who haven’t been given access.
          </p>
          <ul className="admin-list">
            {businesses.map((b) => (
              <li key={b.id} className="admin-business">
                <div className="admin-business-head">
                  <BusinessMark business={b} small />
                  <span className="admin-person">
                    <strong>{b.name}</strong>
                    {b.archived && <small>Archived</small>}
                  </span>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={b.isSuper}
                      disabled={!!busy}
                      aria-label={`Super business: ${b.name}`}
                      onChange={(event) =>
                        void change(b.id, () =>
                          setBusinessSuper(
                            b.id,
                            event.target.checked,
                            event.target.checked
                              ? `${b.name} is now a super business.`
                              : `${b.name} is now an ordinary business.`,
                          ),
                        )
                      }
                    />
                    Super business
                  </label>
                </div>
                {b.isSuper && (
                  <div className="admin-access">
                    <span>Staff who can see it</span>
                    {staff.length ? (
                      staff.map((person) => {
                        const granted = db.access.some(
                          (a) =>
                            a.businessId === b.id && a.userId === person.id,
                        );
                        return (
                          <label className="checkbox-label" key={person.id}>
                            <input
                              type="checkbox"
                              checked={granted}
                              disabled={!!busy}
                              aria-label={`${person.name || person.email} can see ${b.name}`}
                              onChange={() =>
                                void change(`${b.id}:${person.id}`, () =>
                                  setBusinessAccess(
                                    b.id,
                                    person.id,
                                    !granted,
                                    granted
                                      ? `${person.name || person.email} can no longer see ${b.name}.`
                                      : `${person.name || person.email} can now see ${b.name}.`,
                                  ),
                                )
                              }
                            />
                            {person.name || person.email}
                          </label>
                        );
                      })
                    ) : (
                      <small className="muted">
                        No staff yet. Admins always see it.
                      </small>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
