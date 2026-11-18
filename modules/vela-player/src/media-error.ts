/** Error text is the sole string that may leave a native credential attachment. */
export function redactMediaError(message: string): string {
  return message
    .replace(/https?:\/\/[^\s<>"']+/gi, (text) => {
      try {
        const url = new URL(text);
        return url.origin + url.pathname;
      } catch {
        return '[media URL]';
      }
    })
    .replace(
      /\b(?:api_key|x-plex-token|x-emby-token|access_token|authorization|token)\s*[=:]\s*[^\r\n]+/gi,
      '[media credential]',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
}

