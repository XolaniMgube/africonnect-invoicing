import type { DemoEmployee } from "../domain/types";
const KEY = "africonnect:demo-session";
export const employee: DemoEmployee = {
  id: "demo-employee",
  name: "Demo employee",
  email: "user@africonnectsolutions.co.za",
};
export function getSession(): DemoEmployee | null {
  return sessionStorage.getItem(KEY) === employee.id ? employee : null;
}
export function login(email: string, password: string) {
  if (email.trim().toLowerCase() !== employee.email || password !== "User@2026")
    throw new Error(
      "Email or password is incorrect. Use the demo credentials below.",
    );
  try {
    sessionStorage.setItem(KEY, employee.id);
  } catch {
    throw new Error("Allow browser session storage to use demo access.");
  }
  return employee;
}
export function logout() {
  sessionStorage.removeItem(KEY);
}
