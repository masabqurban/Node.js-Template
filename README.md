# Node.js Template

A production-grade **Node.js + TypeScript** REST API starter built on **Express 5**. Validation, auth, docs, logging, security and tests are already in place, and it runs with **zero setup**: no database, no Docker, no `.env` required to try it.

![Node.js](https://img.shields.io/badge/Node.js-22%2B-5fa04e?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000?logo=express)
![OpenAPI](https://img.shields.io/badge/OpenAPI-3.1-6ba539?logo=openapiinitiative&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-green)

> All data in this repository (users, names, emails) is generated placeholder data.
> It is the backend for the companion [React.js Template](https://github.com/masabqurban/React.js-Template): point the React app at this API and it works end to end. See also the [Next.js Template](https://github.com/masabqurban/Next.js-Template).

## Contents

- [Highlights](#highlights)
- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Project structure](#project-structure)
- [Architecture](#architecture)
- [API](#api)
- [Authentication](#authentication)
- [Security](#security)
- [Observability](#observability)
- [Adding a database](#adding-a-database)
- [Testing](#testing)
- [Deployment](#deployment)
- [Use with the React.js Template](#use-with-the-reactjs-template)
- [Customising the template](#customising-the-template)

## Highlights

| Area              | What's included                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Validation**    | One Zod schema per endpoint validates the request, types the handler, filters the response and generates the docs           |
| **Docs**          | OpenAPI 3.1 generated from the code, Swagger UI at `/api/docs`, `npm run openapi` export for client generation              |
| **Auth**          | JWT access tokens + rotating refresh tokens with **reuse detection**; sign-out, suspension and role changes apply instantly |
| **Authorization** | Role-based access control from a single permission table                                                                    |
| **Security**      | Helmet headers, CORS allow-list, rate limiting, scrypt password hashing, timing-safe login, body size limits, validated env |
| **Architecture**  | Feature modules, a composition root, and storage-agnostic repositories; import boundaries enforced by ESLint                |
| **Operations**    | Structured logs with request IDs (pino), liveness and readiness probes, graceful shutdown, non-root Docker image            |
| **Quality**       | Strict TypeScript, ESLint (`strictTypeChecked`), Prettier, Vitest + supertest (44 tests, ~2s), GitHub Actions, Dependabot   |

## Getting started

Requirements: **Node.js 22+** (24 recommended, see `.nvmrc`).

```bash
npm install
cp .env.example .env    # optional in development, required in production
npm run dev
```

- API: <http://localhost:4000/api/v1>
- Interactive docs: <http://localhost:4000/api/docs>
- Demo account (seeded in development only): `demo@example.com` / `password123`

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"password123"}'
```

> Running `npm run dev` without a `.env` file fails with a clear message asking for `JWT_ACCESS_SECRET`. That's deliberate: the server never starts with a missing or weak secret.

## Scripts

| Command                                         | Description                                         |
| ----------------------------------------------- | --------------------------------------------------- |
| `npm run dev`                                   | Start with hot reload (tsx)                         |
| `npm run build`                                 | Compile to `dist/`                                  |
| `npm start`                                     | Run the compiled server                             |
| `npm run lint` / `lint:fix`                     | Lint with ESLint                                    |
| `npm run typecheck`                             | Type-check without emitting                         |
| `npm run format` / `format:check`               | Format with Prettier                                |
| `npm run test` / `test:watch` / `test:coverage` | Run tests with Vitest                               |
| `npm run openapi`                               | Write `openapi.json` (for generating typed clients) |
| `npm run check`                                 | Lint, type check, tests and formatting in one go    |

## Project structure

```text
src/
├── server.ts               Entry point: config, seeding, listen, graceful shutdown
├── app.ts                  Builds the Express app (no side effects, used by tests)
├── container.ts            Composition root: picks the implementation behind every dependency
├── config/env.ts           Zod-validated environment
├── modules/                Feature modules
│   ├── auth/               routes · service · schemas · session repository · tests
│   ├── users/              routes (/users, /me) · service · schemas · repository · tests
│   ├── dashboard/          aggregate queries
│   └── health/             liveness and readiness probes
├── shared/                 Cross-cutting code (never imports modules)
│   ├── http/               defineRoutes() and shared schemas
│   ├── middleware/         authentication, errors, 404
│   ├── rate-limit/         rate limiter + pluggable store
│   ├── auth/permissions.ts RBAC table
│   ├── errors/             AppError
│   └── openapi/            document builder
├── lib/                    logger, password hashing, JWT
├── db/seed.ts              Placeholder demo data (development only)
└── test/helpers.ts         Isolated test app factory
```

## Architecture

**Request flow:** `route → guards (auth, permission) → middleware (rate limit) → Zod validation → handler → service → repository`.

- **Modules own a feature end to end.** Routes stay thin, services hold the business rules and know nothing about HTTP, and repositories hold storage.
- **Dependencies are injected, not imported.** `container.ts` is the only file that decides which implementations are used. A module never imports another module's service or repository at runtime (ESLint enforces this), and shared code never imports a module.
- **No global state.** `createApp(container)` has no side effects, so every test builds its own fully isolated app.
- **One envelope for every response:**

  ```json
  { "success": true, "data": { … }, "meta": { "page": 1, "pageSize": 10, "total": 48, "totalPages": 5 } }
  { "success": false, "error": { "code": "EMAIL_TAKEN", "message": "…", "details": { "field": "email" } } }
  ```

  Clients branch on `error.code`, never on the message.

### `defineRoutes`: one definition per endpoint

```ts
route({
  method: 'patch',
  path: '/:id',
  summary: 'Update a user',
  auth: 'users:write', // sign-in + permission check
  request: { params: idParams, body: updateUserBody },
  response: userDto, // output is filtered through this
  errors: { 404: 'User not found', 409: 'EMAIL_TAKEN' },
  async handler({ params, body, auth }) {
    // fully typed from the schemas
    return { data: toUserDto(await service.update(auth.userId, params.id, body)) };
  },
});
```

This single definition validates the request, types the handler, strips anything `userDto` doesn't declare (so a password hash can never leak), and produces the OpenAPI entry. The docs can't drift from the code because they are generated from it.

## API

| Method                      | Path                        | Access               | Description                                   |
| --------------------------- | --------------------------- | -------------------- | --------------------------------------------- |
| `GET`                       | `/api/v1/health`            | public               | Liveness probe                                |
| `GET`                       | `/api/v1/health/ready`      | public               | Readiness probe (503 if a dependency is down) |
| `POST`                      | `/api/v1/auth/register`     | public, rate-limited | Create an account (role `viewer`)             |
| `POST`                      | `/api/v1/auth/login`        | public, rate-limited | Sign in                                       |
| `POST`                      | `/api/v1/auth/refresh`      | refresh token        | Rotate tokens                                 |
| `POST`                      | `/api/v1/auth/logout`       | refresh token        | End the session                               |
| `GET` / `PATCH`             | `/api/v1/me`                | signed in            | Own profile                                   |
| `GET`                       | `/api/v1/users`             | `users:read`         | List (paginated, `q`, `role`, `status`)       |
| `GET`                       | `/api/v1/users/:id`         | `users:read`         | Get one                                       |
| `POST` / `PATCH` / `DELETE` | `/api/v1/users[/:id]`       | `users:write`        | Manage users                                  |
| `GET`                       | `/api/v1/dashboard/summary` | `dashboard:read`     | Aggregates                                    |

Full request and response schemas are at `/api/docs`.

## Authentication

- **Access tokens** are HS256 JWTs (15 minutes by default) with a pinned algorithm, issuer and audience.
- **Refresh tokens** are random 256-bit strings, stored only as SHA-256 hashes, and rotated on every use.
- **Reuse detection:** presenting a refresh token that was already used means it was copied. The whole session family is revoked, logging out the attacker and the victim alike.
- **Instant revocation:** every request re-checks the session and the user. Sign-out, suspension and role changes take effect on the next request, not when the JWT expires.
- **No account enumeration:** unknown emails and wrong passwords get the same response, and the same hashing work.

| Role     | `users:read` | `users:write` | `dashboard:read` |
| -------- | :----------: | :-----------: | :--------------: |
| `admin`  |      ✓       |       ✓       |        ✓         |
| `editor` |      ✓       |               |        ✓         |
| `viewer` |      ✓       |               |        ✓         |

Edit the table in `src/shared/auth/permissions.ts`. Routes ask for permissions, never for roles.

## Security

| Measure                                                                        | Where                              |
| ------------------------------------------------------------------------------ | ---------------------------------- |
| Security headers (CSP, HSTS, `nosniff`, frame denial…), no `X-Powered-By`      | `helmet()` in `app.ts`             |
| CORS allow-list, no wildcard                                                   | `CORS_ORIGINS`                     |
| Rate limits: 300/min per IP for the API, 20 per 15 min for sign-in and sign-up | `shared/rate-limit`                |
| scrypt password hashing (OWASP parameters), bounded password length            | `lib/crypto.ts`                    |
| 100 kB JSON body limit; malformed JSON gets a 400, not a crash                 | `app.ts`, error handler            |
| Responses filtered through schemas; generic 500s with no stack traces          | `defineRoutes`, error handler      |
| Server refuses to start with a missing/weak secret, or demo data in production | `config/env.ts`                    |
| Credentials redacted from logs                                                 | `lib/logger.ts`                    |
| Non-root, read-only container                                                  | `Dockerfile`, `docker-compose.yml` |

**Behind a proxy or load balancer**, set `TRUST_PROXY` to the number of proxies so the real client IP is used for rate limiting. Leave it at `0` otherwise, or clients could spoof their IP.

## Observability

- **Logs:** JSON lines in production (pretty in development) with a request ID per request. A valid incoming `X-Request-Id` is reused, so traces line up across services.
- **Probes:** `/health` for liveness and `/health/ready` for readiness. Register a check per real dependency in `container.ts`.
- **Shutdown:** on `SIGTERM` the server stops accepting connections, finishes in-flight requests, releases resources and exits, with a 10-second safety timeout.

## Adding a database

Storage sits behind the `UserRepository` and `SessionRepository` interfaces. The in-memory implementations make the template run anywhere, and choosing a database is left to the project. To connect one (PostgreSQL with Prisma or Drizzle, MongoDB, MySQL…):

1. Implement the interfaces, e.g. `createPrismaUserRepository(prisma)` satisfying `UserRepository`.
2. Swap them in `src/container.ts`.
3. Add a readiness check and close the connection in `dispose()`.
4. Move the rate limit store to Redis when you run more than one instance.

Services, routes and tests don't change.

## Testing

```bash
npm run test            # 44 tests in ~2 seconds
npm run test:coverage
```

Tests drive the real HTTP stack with supertest against an isolated app per test (fresh repositories, rate limits and clock), so they run in parallel without a database. They cover registration, login, rate limiting, token tampering and expiry, refresh rotation and reuse detection, sign-out, RBAC, instant demotion and suspension, PATCH semantics, self-protection rules, pagination and filters, dashboard maths with a frozen clock, error handling, security headers, CORS, request IDs, the OpenAPI document, config validation and the demo seed.

## Deployment

```bash
docker build -t nodejs-template .
docker run -p 4000:4000 -e JWT_ACCESS_SECRET="$(openssl rand -base64 48)" nodejs-template
```

The image is multi-stage, contains production dependencies only, runs as the `node` user under `tini` (for correct signal handling) and has a health check. CI builds it and waits for it to become healthy.

### Environment variables

| Variable                                  | Default               | Description                                          |
| ----------------------------------------- | --------------------- | ---------------------------------------------------- |
| `JWT_ACCESS_SECRET`                       | **required**          | At least 32 characters                               |
| `PORT` / `HOST`                           | `4000` / `0.0.0.0`    | Listen address                                       |
| `NODE_ENV`                                | `development`         | `production` turns off docs and demo data by default |
| `CORS_ORIGINS`                            | (none)                | Comma-separated allowed origins                      |
| `TRUST_PROXY`                             | `0`                   | Number of reverse proxies in front of the app        |
| `ACCESS_TOKEN_TTL_SECONDS`                | `900`                 | Access token lifetime                                |
| `REFRESH_TOKEN_TTL_DAYS`                  | `30`                  | Session lifetime                                     |
| `RATE_LIMIT_PER_MINUTE`                   | `300`                 | API requests per IP per minute                       |
| `AUTH_RATE_LIMIT_MAX` / `_WINDOW_SECONDS` | `20` / `900`          | Sign-in and sign-up attempts per IP                  |
| `LOG_LEVEL`                               | `info`                | `fatal` … `trace`, or `silent`                       |
| `API_DOCS_ENABLED`                        | on outside production | Swagger UI and `openapi.json`                        |
| `SEED_DEMO_DATA`                          | on in development     | Placeholder users; rejected in production            |

## Use with the React.js Template

This API implements the exact contract the [React.js Template](https://github.com/masabqurban/React.js-Template) uses, including endpoints, envelopes, pagination and error codes:

```bash
# here
CORS_ORIGINS=http://localhost:5173 npm run dev
# in React.js-Template
VITE_API_URL=http://localhost:4000/api/v1 npm run dev
```

The React app's mock API switches off automatically, and sign-in, the dashboard, user management and session refresh all run against this server.

## Customising the template

1. **Rename** the JWT issuer and audience in `src/lib/jwt.ts` and the API title in `src/shared/openapi/document.ts`.
2. **Add a module:** create `src/modules/<name>/` with `*.schemas.ts`, `*.service.ts`, `*.repository.ts` and `*.routes.ts`, wire it in `container.ts`, and mount it in `app.ts`.
3. **Add a permission:** add a row to `src/shared/auth/permissions.ts` and use it in `auth:` on your routes.
4. **Connect a database:** see [Adding a database](#adding-a-database).

## License

[MIT](./LICENSE)
