/**
 * api.js — all backend API calls
 * Base URL read from VITE_API_URL env var (default: http://localhost:8000)
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000"

async function req(method, path, body, isFormData = false) {
  const opts = {
    method,
    headers: isFormData ? {} : { "Content-Type": "application/json" },
    body: body
      ? isFormData ? body : JSON.stringify(body)
      : undefined,
  }
  const res = await fetch(`${BASE}${path}`, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? "API error")
  }
  if (res.status === 204) return null
  return res.json()
}

// ── Flights ──────────────────────────────────────────────────────────────────

export const api = {

  flights: {
    list:   ()                    => req("GET",  "/api/flights"),
    get:    (id)                  => req("GET",  `/api/flights/${id}`),
    delete: (id)                  => req("DELETE", `/api/flights/${id}`),
    upload: (file, name, notes)   => {
      const fd = new FormData()
      fd.append("file",  file)
      fd.append("name",  name)
      fd.append("notes", notes ?? "")
      return req("POST", "/api/flights", fd, true)
    },
  },

  // ── Config dumps ──────────────────────────────────────────────────────────

  configDumps: {
    upload:      (flightId, rawDump) =>
      req("POST", "/api/config-dumps", { flight_id: flightId, raw_dump: rawDump }),
    getProfiles: (dumpId) =>
      req("GET",  `/api/config-dumps/${dumpId}/profiles`),
  },

  // ── Segments ──────────────────────────────────────────────────────────────

  segments: {
    list:   (flightId)  => req("GET",  `/api/segments?flight_id=${flightId}`),
    get:    (id)        => req("GET",  `/api/segments/${id}`),
    create: (body)      => req("POST", "/api/segments", body),
    delete: (id)        => req("DELETE", `/api/segments/${id}`),
  },

  // ── Analysis ──────────────────────────────────────────────────────────────

  analysis: {
    run: (segmentId, fftCfg) =>
      req("POST", `/api/analysis/run/${segmentId}`, {
        fft: fftCfg ?? { nperseg: 1024, overlap_pct: 0.75, window: "hann", db_scale: true },
      }),
    results:     (segmentId) => req("GET",  `/api/analysis/results/${segmentId}`),
    fftResults:  (segmentId) => req("GET",  `/api/analysis/results/${segmentId}/fft`),
    bodeResults: (segmentId) => req("GET",  `/api/analysis/results/${segmentId}/bode`),
    compare:     (segmentIds, module) =>
      req("POST", "/api/analysis/compare", { segment_ids: segmentIds, module }),
  },

  // ── AI ────────────────────────────────────────────────────────────────────

  ai: {
    analyze: (segmentId, model, template) =>
      req("POST", `/api/ai/analyze/${segmentId}`, {
        model:           model ?? "claude-sonnet-4-20250514",
        prompt_template: template ?? "default",
      }),
    results: (segmentId) => req("GET", `/api/ai/results/${segmentId}`),
    models:  ()          => req("GET", "/api/ai/models"),
  },

  // ── Lookup ────────────────────────────────────────────────────────────────

  maneuvers: {
    list: () => req("GET", "/api/segments/maneuver-types"),
  },
}
