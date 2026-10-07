"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          backgroundColor: "#FAF8F3",
          color: "#1B2A49",
          fontFamily: "system-ui, -apple-system, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
        }}
      >
        <div
          role="alert"
          style={{
            maxWidth: "460px",
            width: "100%",
            backgroundColor: "#FFFFFF",
            border: "2px solid #FF6B6B",
            borderRadius: "16px",
            padding: "28px",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "24px", margin: "0 0 12px" }}>
            ShiftShare hit an unexpected error
          </h1>
          <p style={{ fontSize: "15px", lineHeight: 1.5, margin: "0 0 20px" }}>
            Your event data and verified hours are safe. Reload this page to
            continue.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              minHeight: "44px",
              padding: "10px 20px",
              borderRadius: "12px",
              border: "2px solid #1B2A49",
              backgroundColor: "#FFC93C",
              color: "#1B2A49",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
