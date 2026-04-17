const BASE = "/api";

async function req(method, path, body, isForm = false) {
  const opts = { method, headers: {} };
  if (body) {
    if (isForm) {
      opts.body = body; // FormData — browser sets Content-Type + boundary automatically
    } else {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
  }
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      // FastAPI wraps validation errors in { detail: [...] } or { detail: "string" }
      if (data?.detail) {
        detail = typeof data.detail === "string"
          ? data.detail
          : JSON.stringify(data.detail);
      } else {
        detail = JSON.stringify(data);
      }
    } catch {
      detail = await res.text().catch(() => res.statusText);
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Flights ──────────────────────────────────────────────────────────────────
export const createFlight   = (data)      => req("POST",   "/flights", data);
export const listFlights    = ()          => req("GET",    "/flights");
export const getFlight      = (id)        => req("GET",    `/flights/${id}`);
export const deleteFlight   = (id)        => req("DELETE", `/flights/${id}`);

// ── Segments ─────────────────────────────────────────────────────────────────
export const listSegments   = (flightId)  => req("GET",    `/segments?flight_id=${flightId}`);
export const getSegment     = (id)        => req("GET",    `/segments/${id}`);
export const deleteSegment  = (id)        => req("DELETE", `/segments/${id}`);

export async function uploadSegment({ flightId, label, startIteration, endIteration, notes, csvBlob, filename }) {
  const form = new FormData();
  form.append("flight_id",       flightId);
  form.append("label",           label);
  form.append("start_iteration", String(startIteration));
  form.append("end_iteration",   String(endIteration));
  // Only append notes if it's a non-empty string — never send "null" or ""
  if (notes && typeof notes === "string" && notes.trim()) {
    form.append("notes", notes.trim());
  }
  form.append("file", csvBlob, filename || `${label}.csv`);
  return req("POST", "/segments/upload", form, true);
}

// ── Analysis ─────────────────────────────────────────────────────────────────
export const runAnalysis      = (segId)   => req("POST",  `/analysis/run/${segId}`);
export const getAnalysisResults = (segId) => req("GET",   `/analysis/results/${segId}`);
export const getFFTResults    = (segId)   => req("GET",   `/analysis/results/${segId}/fft`);
export const getBodeResults   = (segId)   => req("GET",   `/analysis/results/${segId}/bode`);
export const compareSegments  = (ids)     => req("POST",  "/analysis/compare", ids);

// ── Config Dumps ─────────────────────────────────────────────────────────────
export const createConfigDump = (data)    => req("POST",  "/config-dumps", data);
export const getConfigProfiles= (id)      => req("GET",   `/config-dumps/${id}/profiles`);
export const getConfigForFlight= (flightId) => req("GET",  `/config-dumps/for-flight/${flightId}/full`);

// ── AI ────────────────────────────────────────────────────────────────────────
export const requestAIAnalysis= (segId)   => req("POST",  `/ai/analyze/${segId}`);
export const getAIResults     = (segId)   => req("GET",   `/ai/results/${segId}`);
