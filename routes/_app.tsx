import { type PageProps } from "$fresh/server.ts";
export default function App({ Component }: PageProps) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Bayside Brickstore</title>
        <link rel="stylesheet" href="/styles.css" />
        <script src="//cache.bricklink.info/vendor/iframeResizer.contentWindow.3.5.3.min.js">
        </script>
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
}
