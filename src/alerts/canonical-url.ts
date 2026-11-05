const TRACKING_PARAMETER = /^(?:utm_.+|fbclid|gclid)$/i;

export function canonicalCompetitionUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hostname = url.hostname.replace(/^www\./i, "");
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMETER.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, url.pathname === "/" && !url.search ? "/" : "");
  } catch {
    return value.trim();
  }
}
