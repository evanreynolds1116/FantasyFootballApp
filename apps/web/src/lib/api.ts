export async function mintDevSession(displayName: string, email?: string): Promise<{ token: string; userId: string }> {
  const res = await fetch("/dev/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName, ...(email ? { email } : {}) }),
  });
  if (!res.ok) throw new Error("Could not start a session.");
  return res.json();
}
