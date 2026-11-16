import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Html({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#090B0E" />
        <link rel="manifest" href="/vela/manifest.webmanifest" />
        <link rel="icon" href="/vela/vela-icon.svg" />
        <link rel="apple-touch-icon" href="/vela/vela-icon-180.png" />
        <ScrollViewStyleReset />
        <script type="module" src="/vela/pwa.js" />
      </head>
      <body>{children}</body>
    </html>
  );
}
