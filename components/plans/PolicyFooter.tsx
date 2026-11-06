// The terms, refund and privacy pages are not published yet (Amit supplies them, POLICY 6/7).
// Until then they are plain text, not links, so nobody lands on a 404 (SPEC L1 is still open).
export function PolicyFooter() {
  return (
    <footer style={{ display: "flex", gap: "1rem", marginTop: "2rem", fontSize: "0.9rem" }}>
      <span>Terms (coming soon)</span>
      <span>Refund policy (coming soon)</span>
      <span>Privacy (coming soon)</span>
    </footer>
  );
}
