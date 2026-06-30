// Centralized API fetching layer with anti-CSRF and HttpOnly cookie session support (P0-2)
const getCsrfToken = (): string => {
  const match = document.cookie.match(/(^|;)\s*csrf_token\s*=\s*([^;]+)/);
  if (match) {
    // Decode the token in case it was stored signed or URL-encoded
    let tok = decodeURIComponent(match[2]);
    if (tok.startsWith("s:")) {
      const parts = tok.split(".");
      tok = parts[0].substring(2);
    }
    return tok;
  }
  return "";
};

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = {
    ...(options.headers || {}),
  } as any;

  // Auto-attach anti-CSRF token on non-GET requests or generally
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  // Auto-attach JSON content type if body is present and not FormData
  if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    ...options,
    credentials: "include", // Ensure signed HttpOnly session cookie is transmitted
    headers,
  });

  if (res.status === 401) {
    localStorage.removeItem("aegis_username");
    localStorage.removeItem("aegis_role");
    window.dispatchEvent(new Event("aegis-unauthorized"));
  }

  return res;
}
