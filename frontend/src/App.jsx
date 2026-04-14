import { useState } from "react"
import { FlightList }    from "./pages/FlightList"
import { FlightDetail }  from "./pages/FlightDetail"
import { SegmentView }   from "./pages/SegmentView"

// Simple client-side router — no dependency needed for this scale
export default function App() {
  const [route, setRoute] = useState({ page: "flights", params: {} })

  const nav = (page, params = {}) => setRoute({ page, params })

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-background-tertiary)" }}>
      <Header nav={nav} />
      <main style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 16px" }}>
        {route.page === "flights"  && <FlightList  nav={nav} />}
        {route.page === "flight"   && <FlightDetail nav={nav} flightId={route.params.flightId} />}
        {route.page === "segment"  && <SegmentView  nav={nav} {...route.params} />}
      </main>
    </div>
  )
}

function Header({ nav }) {
  return (
    <header style={{
      background: "var(--color-background-primary)",
      borderBottom: "1px solid var(--color-border-tertiary)",
      padding: "0 24px",
      height: 56,
      display: "flex",
      alignItems: "center",
      gap: 24,
    }}>
      <button
        onClick={() => nav("flights")}
        style={{
          fontSize: 16,
          fontWeight: 500,
          color: "var(--color-text-primary)",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        Rotorflight Analyzer
      </button>
      <span style={{ color: "var(--color-text-tertiary)", fontSize: 13 }}>
        Blackbox Analysis Platform
      </span>
    </header>
  )
}
