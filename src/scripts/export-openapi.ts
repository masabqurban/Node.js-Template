import { writeFile } from 'node:fs/promises';

import { createApp } from '../app.js';
import { parseConfig } from '../config/env.js';
import { createContainer } from '../container.js';

/**
 * Writes openapi.json without starting a server. Use it to generate typed API
 * clients (openapi-typescript, orval…) or to publish the docs.
 */
const config = parseConfig({
  ...process.env,
  NODE_ENV: 'production',
  API_DOCS_ENABLED: 'true',
  LOG_LEVEL: 'silent',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'x'.repeat(32),
});
const app = createApp(createContainer(config));

const server = app.listen(0, async () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const response = await fetch(`http://127.0.0.1:${port}/api/docs/openapi.json`);
  await writeFile('openapi.json', `${JSON.stringify(await response.json(), null, 2)}\n`);
  console.log('Wrote openapi.json');
  server.close();
});
