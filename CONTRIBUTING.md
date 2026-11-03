# Contributing

Thanks for helping improve this template.

## Development workflow

1. Fork the repository and create a branch from `main`, e.g. `feat/projects-module`.
2. Install dependencies with `npm install`. A Husky pre-commit hook will lint and format the files you stage.
3. Make your change, then run:

   ```bash
   npm run check     # lint, type check, tests, formatting
   npm run build
   ```

4. Open a pull request using the template.

## Conventions

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- **Every endpoint goes through `defineRoutes`**, with request schemas, a response schema and documented errors.
- **Services don't know about HTTP.** They take plain inputs, return plain data and throw `AppError` with a stable `code`.
- **Depend on interfaces.** Services receive repositories and collaborators as parameters. Wire implementations in `src/container.ts` only.
- **Modules don't import each other at runtime.** Type imports are fine. ESLint enforces this.
- **Ask for permissions, not roles.** Add permissions to `src/shared/auth/permissions.ts`.
- **Test through HTTP.** Use `createTestApp()` from `src/test/helpers.ts` and assert on status codes and `error.code`.
- **Log with the request logger** (`req.log`) or the injected logger. `console` is reserved for CLI scripts.
