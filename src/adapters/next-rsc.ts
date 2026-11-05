/** Decode the string payloads emitted by Next.js Flight streaming scripts. */
export function extractNextFlightText(html: string): string {
  let payload = "";
  for (const match of html.matchAll(
    /self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)/g,
  )) {
    try {
      payload += JSON.parse(`"${match[1]}"`);
    } catch {
      continue;
    }
  }
  return payload;
}

/** Parse a JSON array assigned to a property inside a decoded Flight payload. */
export function extractNextJsonArray<T>(payload: string, property: string): T[] {
  const marker = `"${property}":[`;
  const start = payload.indexOf(marker);
  if (start < 0) return [];

  const arrayStart = start + marker.length - 1;
  const arrayEnd = findJsonValueEnd(payload, arrayStart);
  if (arrayEnd < 0) return [];

  try {
    const value: unknown = JSON.parse(payload.slice(arrayStart, arrayEnd + 1));
    return Array.isArray(value) ? value as T[] : [];
  } catch {
    return [];
  }
}

function findJsonValueEnd(value: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "[" || character === "{") {
      depth += 1;
    } else if (character === "]" || character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}
