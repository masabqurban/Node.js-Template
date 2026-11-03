# Agent instructions

- Read `README.md` (architecture, auth, security) and `CONTRIBUTING.md` (conventions) first.
- ESM with `NodeNext` resolution: relative imports end in `.js`, even in `.ts` files.
- Every endpoint is declared with `defineRoutes` (`src/shared/http/define-routes.ts`) with request and response Zod schemas.
- Business rules live in `*.service.ts` and throw `AppError` with a stable `code`. Storage lives behind `*.repository.ts` interfaces, wired in `src/container.ts`.
- Modules must not import each other at runtime, and `src/shared` must not import modules.
- Tests use `createTestApp()` and run through HTTP with supertest.
- Run `npm run check` and `npm run build` before considering work done.
