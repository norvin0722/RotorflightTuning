/**
 * api.js — all backend API calls
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

export const api = {

  // ── Flights — metadata only, no file upload ──────────────────────────────
  flights: {
    create: (meta) => req("POST", "/api/flights", meta),
    list:   ()     => req("GET",  "/api/flights"),
    get:    (id)   => req("GET",  `/api/flights/${id}`),
    delete: (id)   => req("DELETE", `/api/flights/${id}`),
  },

  // ── Config dumps ──────────────────────────────────────────────────────────
  configDumps: {
    upload:      (flightId, rawDump) =>
      req("POST", "/api/config-dumps", { flight_id: flightId, raw_dump: rawDump }),
    getProfiles: (dumpId) =>
      req("GET", `/api/config-dumps/${dumpId}/profiles`),
  },

  // ── Segments — CSV slice upload from browser ──────────────────────────────
  segments: {
    /**
     * Upload a segment CSV slice.
     * @param {object} meta  - { flightId, label, startIteration, endIteration,
     *                           rowCount, maneuverTypeName, pidProfileIndex,
     *                           rateProfileIndex, notes }
     * @param {string} csvText - the sliced CSV content (header + data rows)
     */
    upload: (meta, csvText) => {
      const fd = new FormData()
      fd.append("file",               new Blob([csvText], { type: "text/csv" }), `${meta.label}.csv`)
      fd.append("flight_id",          meta.flightId)
      fd.append("label",              meta.label)
      fd.append("start_iteration",    String(meta.startIteration))
      fd.append("end_iteration",      String(meta.endIteration))
      fd.append("row_count",          String(meta.rowCount))
      fd.append("maneuver_type_name", meta.maneuverTypeName ?? "")
      fd.append("pid_profile_index",  meta.pidProfileIndex  != null ? String(meta.pidProfileIndex)  : "")
      fd.append("rate_profile_index", meta.rateProfileIndex != null ? String(meta.rateProfileIndex) : "")
      fd.append("notes",              meta.notes ?? "")
      return req("POST", "/api/segments/upload", fd, true)
    },

    list:   (flightId)   => req("GET",    `/api/segments?flight_id=${flightId}`),
    get:    (segmentId)  => req("GET",    `/api/segments/${segmentId}`),
    delete: (segmentId)  => req("DELETE", `/api/segments/${segmentId}`),
  },

  // ── Analysis ──────────────────────────────────────────────────────────────
  analysis: {
    run: (segmentId, fftCfg) =>
      req("POST", `/api/analysis/run/${segmentId}`, {
        fft: fftCfg ?? { nperseg: 1024, overlap_pct: 0.75, window: "hann", db_scale: true },
      }),
    results:     (segmentId) => req("GET", `/api/analysis/results/${segmentId}`),
    fftResults:  (segmentId) => req("GET", `/api/analysis/results/${segmentId}/fft`),
    bodeResults: (segmentId) => req("GET", `/api/analysis/results/${segmentId}/bode`),
    compare:     (segmentIds, module) =>
      req("POST", "/api/analysis/compare", { segment_ids: segmentIds, module }),
  },

  // ── AI ────────────────────────────────────────────────────────────────────
  ai: {
    analyze: (segmentId, model, template) =>
      req("POST", `/api/ai/analyze/${segmentId}`, {
        model:           model   ?? "claude-sonnet-4-20250514",
        prompt_template: template ?? "default",
      }),
    results: (segmentId) => req("GET", `/api/ai/results/${segmentId}`),
    models:  ()          => req("GET", "/api/ai/models"),
  },
}
